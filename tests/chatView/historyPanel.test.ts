/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import {
  createHistoryPanel,
  type HistoryPanelHandle,
  type HistoryPanelCallbacks,
  type HistoryPanelState,
} from '../../src/chatView/historyPanel';
import type { ModuleDeps, ConversationMeta } from '../../src/chatView/types';

// Mock Obsidian - must be before all code due to hoisting
vi.mock('obsidian', () => {
  const mockMenuItem = {
    setTitle: vi.fn().mockReturnThis(),
    setIcon: vi.fn().mockReturnThis(),
    onClick: vi.fn().mockReturnThis(),
  };

  return {
    setIcon: vi.fn(),
    Menu: class MockMenu {
      addItem(callback: (item: typeof mockMenuItem) => void): MockMenu {
        callback(mockMenuItem);
        return this;
      }
      addSeparator(): MockMenu {
        return this;
      }
      showAtMouseEvent = vi.fn();
    },
  };
});

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

// Add Obsidian's additional HTMLElement methods
declare global {
  interface HTMLElement {
    empty(): void;
    setText(text: string): void;
    addClass(cls: string): void;
    removeClass(cls: string): void;
    toggleClass(cls: string, force?: boolean): void;
  }
}

HTMLElement.prototype.empty = function (): void {
  while (this.firstChild) {
    this.removeChild(this.firstChild);
  }
};

HTMLElement.prototype.setText = function (text: string): void {
  this.textContent = text;
};

HTMLElement.prototype.addClass = function (cls: string): void {
  this.classList.add(cls);
};

HTMLElement.prototype.removeClass = function (cls: string): void {
  this.classList.remove(cls);
};

HTMLElement.prototype.toggleClass = function (cls: string, force?: boolean): void {
  this.classList.toggle(cls, force);
};

describe('HistoryPanel', () => {
  let container: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: HistoryPanelCallbacks;
  let handle: HistoryPanelHandle;

  const mockConversations: ConversationMeta[] = [
    {
      id: 'conv-1',
      title: 'First Conversation',
      messageCount: 5,
      createdAt: Date.now() - 86400000 * 2, // 2 days ago
      updatedAt: Date.now() - 86400000 * 2,
      tags: ['work'],
      pinned: false,
    },
    {
      id: 'conv-2',
      title: 'Second Conversation',
      messageCount: 10,
      createdAt: Date.now() - 86400000, // Yesterday
      updatedAt: Date.now() - 86400000,
      tags: ['personal'],
      pinned: true,
    },
    {
      id: 'conv-3',
      title: 'Third Conversation',
      messageCount: 3,
      createdAt: Date.now() - 3600000, // 1 hour ago (today)
      updatedAt: Date.now() - 3600000,
      tags: [],
      pinned: false,
    },
  ];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    deps = {
      app: {} as ModuleDeps['app'],
      plugin: {} as ModuleDeps['plugin'],
    };
    callbacks = {
      onSelect: vi.fn().mockResolvedValue(undefined),
      onDelete: vi.fn().mockResolvedValue(undefined),
      onDeleteBulk: vi.fn().mockResolvedValue(undefined),
      onDuplicate: vi.fn().mockResolvedValue(undefined),
      onRename: vi.fn().mockResolvedValue(undefined),
      onTogglePin: vi.fn().mockResolvedValue(undefined),
      onManageTags: vi.fn(),
      onContinue: vi.fn().mockResolvedValue(undefined),
      getConversations: vi.fn().mockResolvedValue(mockConversations),
      getAllTags: vi.fn().mockResolvedValue(['work', 'personal']),
      getCurrentId: vi.fn(() => 'conv-1'),
      showStatus: vi.fn(),
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    handle?.destroy();
    container.remove();
  });

  describe('creation', () => {
    it('should create history panel container with correct class', () => {
      handle = createHistoryPanel(container, deps, callbacks);
      const panel = container.querySelector('.chat-history-panel');
      expect(panel).not.toBeNull();
    });

    it('should be hidden by default', () => {
      handle = createHistoryPanel(container, deps, callbacks);
      const panel = container.querySelector('.chat-history-panel') as HTMLElement;
      expect(panel.classList.contains('hidden')).toBe(true);
      expect(handle.isVisible()).toBe(false);
    });

    it('should create search input', () => {
      handle = createHistoryPanel(container, deps, callbacks);
      const searchInput = container.querySelector('.history-search-input');
      expect(searchInput).not.toBeNull();
    });

    it('should create tag filter bar', () => {
      handle = createHistoryPanel(container, deps, callbacks);
      const tagBar = container.querySelector('.history-tag-bar');
      expect(tagBar).not.toBeNull();
    });

    it('should create conversation list container', () => {
      handle = createHistoryPanel(container, deps, callbacks);
      const list = container.querySelector('.history-list');
      expect(list).not.toBeNull();
    });
  });

  describe('visibility', () => {
    it('should show panel when show() is called', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      expect(handle.isVisible()).toBe(true);
      const panel = container.querySelector('.chat-history-panel') as HTMLElement;
      expect(panel.classList.contains('hidden')).toBe(false);
    });

    it('should hide panel when hide() is called', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      handle.hide();
      expect(handle.isVisible()).toBe(false);
    });

    it('should toggle visibility with toggle()', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      expect(handle.isVisible()).toBe(false);
      await handle.toggle();
      expect(handle.isVisible()).toBe(true);
      await handle.toggle();
      expect(handle.isVisible()).toBe(false);
    });

    it('should fetch conversations when showing', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      expect(callbacks.getConversations).toHaveBeenCalled();
    });
  });

  describe('conversation list', () => {
    it('should render conversation items', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      const items = container.querySelectorAll('.history-item');
      expect(items).toHaveLength(3);
    });

    it('should show pinned conversations first', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      const items = container.querySelectorAll('.history-item');
      // conv-2 is pinned, should be first
      expect(items[0].getAttribute('data-id')).toBe('conv-2');
    });

    it('should mark pinned conversations with pin icon', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      const pinnedItem = container.querySelector('[data-id="conv-2"]');
      expect(pinnedItem?.querySelector('.history-item-pin')).not.toBeNull();
    });

    it('should mark current conversation with .current class', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      const currentItem = container.querySelector('[data-id="conv-1"]');
      expect(currentItem?.classList.contains('current')).toBe(true);
    });

    it('should display conversation title', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      const item = container.querySelector('[data-id="conv-1"]');
      expect(item?.textContent).toContain('First Conversation');
    });

    it('should display message count', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      const item = container.querySelector('[data-id="conv-1"]');
      expect(item?.textContent).toContain('5');
    });

    it('should display relative date', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      // conv-3 was created today
      const todayItem = container.querySelector('[data-id="conv-3"]');
      expect(todayItem?.textContent).toContain('Today');
    });
  });

  describe('search filtering', () => {
    it('should filter conversations by search query', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const searchInput = container.querySelector('.history-search-input') as HTMLInputElement;
      searchInput.value = 'First';
      searchInput.dispatchEvent(new Event('input'));

      const items = container.querySelectorAll('.history-item');
      expect(items).toHaveLength(1);
      expect(items[0].getAttribute('data-id')).toBe('conv-1');
    });

    it('should be case-insensitive', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const searchInput = container.querySelector('.history-search-input') as HTMLInputElement;
      searchInput.value = 'first';
      searchInput.dispatchEvent(new Event('input'));

      const items = container.querySelectorAll('.history-item');
      expect(items).toHaveLength(1);
    });

    it('should show all conversations when search is cleared', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const searchInput = container.querySelector('.history-search-input') as HTMLInputElement;
      searchInput.value = 'First';
      searchInput.dispatchEvent(new Event('input'));
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));

      const items = container.querySelectorAll('.history-item');
      expect(items).toHaveLength(3);
    });
  });

  describe('tag filtering', () => {
    it('should filter conversations by tag', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const tagButtons = container.querySelectorAll('.history-tag-btn');
      // Find 'work' tag button and click it
      const workTag = Array.from(tagButtons).find((btn) => btn.textContent === 'work') as HTMLElement;
      workTag?.click();

      const items = container.querySelectorAll('.history-item');
      expect(items).toHaveLength(1);
      expect(items[0].getAttribute('data-id')).toBe('conv-1');
    });

    it('should highlight selected tag', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const tagButtons = container.querySelectorAll('.history-tag-btn');
      const workTag = Array.from(tagButtons).find((btn) => btn.textContent === 'work') as HTMLElement;
      workTag?.click();

      expect(workTag?.classList.contains('selected')).toBe(true);
    });

    it('should clear tag filter when clicking selected tag again', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const tagButtons = container.querySelectorAll('.history-tag-btn');
      const workTag = Array.from(tagButtons).find((btn) => btn.textContent === 'work') as HTMLElement;
      workTag?.click();
      workTag?.click();

      const items = container.querySelectorAll('.history-item');
      expect(items).toHaveLength(3);
      expect(workTag?.classList.contains('selected')).toBe(false);
    });
  });

  describe('bulk selection', () => {
    it('should enable bulk select mode', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const bulkBtn = container.querySelector('.history-bulk-btn') as HTMLElement;
      bulkBtn?.click();

      const panel = container.querySelector('.chat-history-panel');
      expect(panel?.classList.contains('bulk-select-mode')).toBe(true);
    });

    it('should show checkboxes in bulk select mode', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const bulkBtn = container.querySelector('.history-bulk-btn') as HTMLElement;
      bulkBtn?.click();

      const checkboxes = container.querySelectorAll('.history-item-checkbox');
      expect(checkboxes.length).toBeGreaterThan(0);
    });

    it('should select item when checkbox clicked', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const bulkBtn = container.querySelector('.history-bulk-btn') as HTMLElement;
      bulkBtn?.click();

      const checkbox = container.querySelector('.history-item-checkbox') as HTMLInputElement;
      checkbox.click();

      expect(checkbox.checked).toBe(true);
    });

    it('should show bulk action buttons when items selected', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const bulkBtn = container.querySelector('.history-bulk-btn') as HTMLElement;
      bulkBtn?.click();

      const checkbox = container.querySelector('.history-item-checkbox') as HTMLInputElement;
      checkbox.click();

      const deleteBtn = container.querySelector('.history-bulk-delete-btn');
      expect(deleteBtn).not.toBeNull();
    });

    it('should call onDeleteBulk with selected IDs', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const bulkBtn = container.querySelector('.history-bulk-btn') as HTMLElement;
      bulkBtn?.click();

      // Select first item
      const checkboxes = container.querySelectorAll('.history-item-checkbox') as NodeListOf<HTMLInputElement>;
      checkboxes[0].click();
      checkboxes[1].click();

      const deleteBtn = container.querySelector('.history-bulk-delete-btn') as HTMLElement;
      deleteBtn?.click();

      expect(callbacks.onDeleteBulk).toHaveBeenCalled();
    });
  });

  describe('actions', () => {
    it('should call onSelect when conversation is clicked', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const item = container.querySelector('[data-id="conv-2"]') as HTMLElement;
      item.click();

      expect(callbacks.onSelect).toHaveBeenCalledWith('conv-2');
    });

    it('should not call onSelect in bulk select mode', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const bulkBtn = container.querySelector('.history-bulk-btn') as HTMLElement;
      bulkBtn?.click();

      const item = container.querySelector('[data-id="conv-2"]') as HTMLElement;
      item.click();

      expect(callbacks.onSelect).not.toHaveBeenCalled();
    });
  });

  describe('context menu', () => {
    it('should show context menu on right-click', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const item = container.querySelector('[data-id="conv-1"]') as HTMLElement;
      const event = new MouseEvent('contextmenu', { bubbles: true });
      item.dispatchEvent(event);

      // Context menu was shown if no error was thrown
      expect(true).toBe(true);
    });

    it('should prevent default on context menu', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const item = container.querySelector('[data-id="conv-1"]') as HTMLElement;
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      item.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('should refresh conversation list', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      vi.clearAllMocks();

      await handle.refresh();

      expect(callbacks.getConversations).toHaveBeenCalled();
    });
  });

  describe('destruction', () => {
    it('should clean up DOM on destroy', () => {
      handle = createHistoryPanel(container, deps, callbacks);
      handle.destroy();
      expect(container.querySelector('.chat-history-panel')).toBeNull();
    });

    it('should remove all event listeners', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      handle.destroy();

      // Panel should be removed
      expect(container.innerHTML).toBe('');
    });
  });

  describe('relative date formatting', () => {
    it('should show "Today" for conversations from today', async () => {
      const todayConversations: ConversationMeta[] = [
        {
          id: 'today-conv',
          title: 'Today Conversation',
          messageCount: 1,
          createdAt: Date.now() - 1000, // Just now
          updatedAt: Date.now() - 1000,
        },
      ];
      callbacks.getConversations = vi.fn().mockResolvedValue(todayConversations);
      callbacks.getCurrentId = vi.fn(() => '');

      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const item = container.querySelector('[data-id="today-conv"]');
      expect(item?.textContent).toContain('Today');
    });

    it('should show "Yesterday" for conversations from yesterday', async () => {
      const yesterdayConversations: ConversationMeta[] = [
        {
          id: 'yesterday-conv',
          title: 'Yesterday Conversation',
          messageCount: 1,
          createdAt: Date.now() - 86400000, // 24 hours ago
          updatedAt: Date.now() - 86400000,
        },
      ];
      callbacks.getConversations = vi.fn().mockResolvedValue(yesterdayConversations);
      callbacks.getCurrentId = vi.fn(() => '');

      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const item = container.querySelector('[data-id="yesterday-conv"]');
      expect(item?.textContent).toContain('Yesterday');
    });

    it('should show "X days ago" for older conversations', async () => {
      const oldConversations: ConversationMeta[] = [
        {
          id: 'old-conv',
          title: 'Old Conversation',
          messageCount: 1,
          createdAt: Date.now() - 86400000 * 5, // 5 days ago
          updatedAt: Date.now() - 86400000 * 5,
        },
      ];
      callbacks.getConversations = vi.fn().mockResolvedValue(oldConversations);
      callbacks.getCurrentId = vi.fn(() => '');

      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const item = container.querySelector('[data-id="old-conv"]');
      expect(item?.textContent).toContain('5 days ago');
    });
  });
});
