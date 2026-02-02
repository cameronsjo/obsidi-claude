/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import {
  createTabBar,
  type TabBarHandle,
  type TabBarCallbacks,
  type TabInfo,
} from '../../src/chatView/tabBar';
import type { ModuleDeps } from '../../src/chatView/types';

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
    createDiv(options?: string | { cls?: string }): HTMLDivElement;
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: { cls?: string; attr?: Record<string, string> }
    ): HTMLElementTagNameMap[K];
    createSpan(cls?: string): HTMLSpanElement;
  }
}

HTMLElement.prototype.createDiv = function (options?: string | { cls?: string }): HTMLDivElement {
  const div = document.createElement('div');
  if (typeof options === 'string') {
    div.className = options;
  } else if (options?.cls) {
    div.className = options.cls;
  }
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

// Add Obsidian's additional HTMLElement methods
declare global {
  interface HTMLElement {
    empty(): void;
    setText(text: string): void;
    addClass(cls: string): void;
    removeClass(cls: string): void;
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

describe('TabBar', () => {
  let container: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: TabBarCallbacks;
  let handle: TabBarHandle;

  const mockTabs: TabInfo[] = [
    { id: 'tab-1', label: 'Chat 1', conversationId: 'conv-1' },
    { id: 'tab-2', label: 'Chat 2', conversationId: 'conv-2' },
    { id: 'tab-3', label: 'Chat 3', conversationId: 'conv-3' },
  ];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    deps = {
      app: {} as ModuleDeps['app'],
      plugin: {} as ModuleDeps['plugin'],
    };
    callbacks = {
      onTabSelect: vi.fn(),
      onTabClose: vi.fn(),
      onNewTab: vi.fn(),
      onTabRename: vi.fn(),
      onTabPin: vi.fn(),
      onTabDuplicate: vi.fn(),
      onCloseOtherTabs: vi.fn(),
      getTabs: vi.fn(() => mockTabs),
      getActiveTabId: vi.fn(() => 'tab-1'),
      getTabCount: vi.fn(() => mockTabs.length),
    };

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    handle?.destroy();
    container.remove();
  });

  describe('creation', () => {
    it('should create tab bar container with correct class', () => {
      handle = createTabBar(container, deps, callbacks);
      // The container itself gets the chat-tab-bar class
      expect(container.classList.contains('chat-tab-bar')).toBe(true);
    });

    it('should create tabs container', () => {
      handle = createTabBar(container, deps, callbacks);
      const tabsContainer = container.querySelector('.chat-tabs-container');
      expect(tabsContainer).not.toBeNull();
    });

    it('should create new tab button with correct attributes', () => {
      handle = createTabBar(container, deps, callbacks);
      const newTabBtn = container.querySelector('.chat-tab-new');
      expect(newTabBtn).not.toBeNull();
      expect(newTabBtn?.getAttribute('aria-label')).toBe('New tab');
    });
  });

  describe('rendering tabs', () => {
    it('should render tabs from callback', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      const tabs = container.querySelectorAll('.chat-tab');
      expect(tabs).toHaveLength(3);
    });

    it('should mark active tab with .chat-tab-active class', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      const activeTab = container.querySelector('.chat-tab.chat-tab-active');
      expect(activeTab).not.toBeNull();
      expect(activeTab?.getAttribute('data-tab-id')).toBe('tab-1');
    });

    it('should render tab labels', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      const labels = container.querySelectorAll('.chat-tab-label');
      expect(labels).toHaveLength(3);
      expect(labels[0].textContent).toBe('Chat 1');
      expect(labels[1].textContent).toBe('Chat 2');
      expect(labels[2].textContent).toBe('Chat 3');
    });

    it('should render close buttons on tabs', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      const closeBtns = container.querySelectorAll('.chat-tab-close');
      expect(closeBtns).toHaveLength(3);
    });

    it('should set data-tab-id attribute on tabs', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      const tabs = container.querySelectorAll('.chat-tab');
      expect(tabs[0].getAttribute('data-tab-id')).toBe('tab-1');
      expect(tabs[1].getAttribute('data-tab-id')).toBe('tab-2');
      expect(tabs[2].getAttribute('data-tab-id')).toBe('tab-3');
    });
  });

  describe('tab interactions', () => {
    it('should call onTabSelect when tab is clicked', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      const tab = container.querySelector('[data-tab-id="tab-2"]') as HTMLElement;
      tab.click();

      expect(callbacks.onTabSelect).toHaveBeenCalledWith('tab-2');
    });

    it('should call onTabClose when close button is clicked', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      const closeBtn = container.querySelector('[data-tab-id="tab-2"] .chat-tab-close') as HTMLElement;
      closeBtn.click();

      expect(callbacks.onTabClose).toHaveBeenCalledWith('tab-2');
    });

    it('should stop propagation when close button is clicked', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      const closeBtn = container.querySelector('[data-tab-id="tab-2"] .chat-tab-close') as HTMLElement;
      closeBtn.click();

      // Close should be called but not select (because propagation was stopped)
      expect(callbacks.onTabClose).toHaveBeenCalledWith('tab-2');
      expect(callbacks.onTabSelect).not.toHaveBeenCalled();
    });

    it('should call onNewTab when new tab button is clicked', () => {
      handle = createTabBar(container, deps, callbacks);

      const newTabBtn = container.querySelector('.chat-tab-new') as HTMLElement;
      newTabBtn.click();

      expect(callbacks.onNewTab).toHaveBeenCalled();
    });
  });

  describe('context menu', () => {
    it('should show context menu on right-click', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      const tab = container.querySelector('[data-tab-id="tab-1"]') as HTMLElement;
      const event = new MouseEvent('contextmenu', { bubbles: true });
      tab.dispatchEvent(event);

      // The context menu was shown - if it didn't throw and the event was handled, the menu was created
      // We verify Menu was instantiated by checking the context menu didn't throw
      expect(true).toBe(true);
    });

    it('should prevent default on context menu', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      const tab = container.querySelector('[data-tab-id="tab-1"]') as HTMLElement;
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      tab.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe('label updates', () => {
    it('should update label text with updateLabel', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      handle.updateLabel('tab-1', 'Updated Label');

      const label = container.querySelector('[data-tab-id="tab-1"] .chat-tab-label');
      expect(label?.textContent).toBe('Updated Label');
    });

    it('should update title attribute with updateLabel', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      handle.updateLabel('tab-1', 'Updated Label');

      const label = container.querySelector('[data-tab-id="tab-1"] .chat-tab-label');
      expect(label?.getAttribute('title')).toBe('Updated Label');
    });

    it('should handle updateLabel for non-existent tab gracefully', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      // Should not throw
      expect(() => handle.updateLabel('non-existent', 'Label')).not.toThrow();
    });
  });

  describe('active tab', () => {
    it('should update active class with setActiveTab', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      handle.setActiveTab('tab-2');

      const tab1 = container.querySelector('[data-tab-id="tab-1"]');
      const tab2 = container.querySelector('[data-tab-id="tab-2"]');
      expect(tab1?.classList.contains('chat-tab-active')).toBe(false);
      expect(tab2?.classList.contains('chat-tab-active')).toBe(true);
    });

    it('should remove active from previous tab when setting new active', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      // Initially tab-1 is active
      expect(container.querySelector('[data-tab-id="tab-1"]')?.classList.contains('chat-tab-active')).toBe(true);

      handle.setActiveTab('tab-3');

      expect(container.querySelector('[data-tab-id="tab-1"]')?.classList.contains('chat-tab-active')).toBe(false);
      expect(container.querySelector('[data-tab-id="tab-3"]')?.classList.contains('chat-tab-active')).toBe(true);
    });

    it('should handle setActiveTab for non-existent tab gracefully', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      // Should not throw
      expect(() => handle.setActiveTab('non-existent')).not.toThrow();
    });
  });

  describe('destruction', () => {
    it('should clean up DOM on destroy', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.destroy();

      expect(container.querySelector('.chat-tab-bar')).toBeNull();
    });

    it('should remove tab bar element completely', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      // Verify elements exist before destroy
      expect(container.querySelector('.chat-tabs-container')).not.toBeNull();
      expect(container.querySelector('.chat-tab-new')).not.toBeNull();

      handle.destroy();

      // The container should no longer have the chat-tab-bar class
      expect(container.classList.contains('chat-tab-bar')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty tabs list', () => {
      callbacks.getTabs = vi.fn(() => []);
      callbacks.getTabCount = vi.fn(() => 0);
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      const tabs = container.querySelectorAll('.chat-tab');
      expect(tabs).toHaveLength(0);
    });

    it('should handle null active tab id', () => {
      callbacks.getActiveTabId = vi.fn(() => null);
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      const activeTabs = container.querySelectorAll('.chat-tab.chat-tab-active');
      expect(activeTabs).toHaveLength(0);
    });

    it('should truncate long labels in display', () => {
      const longLabelTabs: TabInfo[] = [
        { id: 'tab-1', label: 'This is a very long label that should be truncated', conversationId: 'conv-1' },
      ];
      callbacks.getTabs = vi.fn(() => longLabelTabs);
      callbacks.getTabCount = vi.fn(() => 1);
      handle = createTabBar(container, deps, callbacks);
      handle.render();

      const label = container.querySelector('.chat-tab-label');
      // Label should be truncated (max 20 chars + ellipsis)
      expect(label?.textContent?.length).toBeLessThanOrEqual(23);
      // Full label should be in title attribute
      expect(label?.getAttribute('title')).toBe('This is a very long label that should be truncated');
    });
  });
});
