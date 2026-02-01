/**
 * Tab bar module for ChatView.
 * Manages conversation tabs for multi-conversation support.
 */
import { setIcon } from 'obsidian';
import type { ChatTab, ModuleDeps, ModuleHandle } from './types';
import { generateId } from '../types';

export interface TabBarCallbacks {
  onTabSelect: (tabId: string) => Promise<void>;
  onTabClose: (tabId: string) => Promise<void>;
  onNewTab: () => Promise<void>;
  getCurrentConversationId: () => string;
  getConversationTitle: (id: string) => string;
}

export interface TabBarHandle extends ModuleHandle {
  getTabs(): ChatTab[];
  getActiveTabId(): string | null;
  addTab(conversationId: string): string;
  removeTab(tabId: string): void;
  setActiveTab(tabId: string): void;
  updateTabLabel(tabId: string, label: string): void;
  render(): void;
}

export function createTabBar(
  container: HTMLElement,
  deps: ModuleDeps,
  callbacks: TabBarCallbacks
): TabBarHandle {
  // State
  let tabs: ChatTab[] = [];
  let activeTabId: string | null = null;

  // Build UI
  const tabBar = container.createDiv('chat-tab-bar');

  function initialize(): void {
    // Create initial tab for current conversation
    const currentId = callbacks.getCurrentConversationId();
    if (currentId) {
      const tabId = addTab(currentId);
      setActiveTab(tabId);
    }
  }

  function addTab(conversationId: string): string {
    // Check if tab already exists for this conversation
    const existing = tabs.find((t) => t.conversationId === conversationId);
    if (existing) {
      return existing.id;
    }

    const newTab: ChatTab = {
      id: generateId(),
      conversationId,
      label: callbacks.getConversationTitle(conversationId) || 'New Chat',
    };

    tabs.push(newTab);
    render();
    return newTab.id;
  }

  function removeTab(tabId: string): void {
    const index = tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;

    tabs.splice(index, 1);

    // If we removed the active tab, switch to another
    if (activeTabId === tabId) {
      if (tabs.length > 0) {
        const newIndex = Math.min(index, tabs.length - 1);
        setActiveTab(tabs[newIndex].id);
        callbacks.onTabSelect(tabs[newIndex].id);
      } else {
        activeTabId = null;
        callbacks.onNewTab();
      }
    }

    render();
  }

  function setActiveTab(tabId: string): void {
    activeTabId = tabId;
    render();
  }

  function updateTabLabel(tabId: string, label: string): void {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.label = label;
      render();
    }
  }

  function render(): void {
    tabBar.empty();

    // Don't show tab bar if only one tab
    if (tabs.length <= 1) {
      tabBar.style.display = 'none';
      return;
    }

    tabBar.style.display = 'flex';

    for (const tab of tabs) {
      const tabEl = tabBar.createDiv('chat-tab');
      if (tab.id === activeTabId) {
        tabEl.addClass('chat-tab-active');
      }

      // Tab label
      const labelEl = tabEl.createSpan('chat-tab-label');
      const displayLabel = tab.label.length > 20 ? tab.label.slice(0, 17) + '...' : tab.label;
      labelEl.setText(displayLabel);
      labelEl.onclick = () => {
        if (tab.id !== activeTabId) {
          setActiveTab(tab.id);
          callbacks.onTabSelect(tab.id);
        }
      };

      // Close button
      const closeBtn = tabEl.createEl('button', {
        cls: 'chat-tab-close',
        attr: { 'aria-label': 'Close tab' },
      });
      setIcon(closeBtn, 'x');
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        callbacks.onTabClose(tab.id);
      };
    }

    // New tab button
    const newTabBtn = tabBar.createEl('button', {
      cls: 'chat-tab-new',
      attr: { 'aria-label': 'New tab' },
    });
    setIcon(newTabBtn, 'plus');
    newTabBtn.onclick = () => callbacks.onNewTab();
  }

  function destroy(): void {
    tabBar.remove();
  }

  // Initialize with current conversation
  initialize();

  return {
    getTabs: () => [...tabs],
    getActiveTabId: () => activeTabId,
    addTab,
    removeTab,
    setActiveTab,
    updateTabLabel,
    render,
    destroy,
  };
}
