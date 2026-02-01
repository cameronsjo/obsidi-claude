/**
 * Tab bar module for ChatView.
 * Provides tab management functionality for multiple chat conversations.
 */
import { setIcon, Menu } from 'obsidian';
import type { ModuleDeps, ModuleHandle } from './types';

/**
 * Information about a single tab.
 */
export interface TabInfo {
  id: string;
  label: string;
  conversationId: string;
}

/**
 * Callbacks for tab bar to communicate with parent.
 */
export interface TabBarCallbacks {
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
  onTabRename: (tabId: string, newLabel: string) => void;
  getTabs: () => TabInfo[];
  getActiveTabId: () => string | null;
  saveState: () => void;
}

/**
 * Handle for controlling the tab bar.
 */
export interface TabBarHandle extends ModuleHandle {
  render(): void;
  updateLabel(tabId: string, label: string): void;
  setActiveTab(tabId: string): void;
}

const MAX_LABEL_LENGTH = 20;

/**
 * Create a tab bar for managing chat tabs.
 * @param container - Parent element to attach the tab bar to
 * @param _deps - Module dependencies (reserved for future use)
 * @param callbacks - Callbacks for parent communication
 */
export function createTabBar(
  container: HTMLElement,
  _deps: ModuleDeps,
  callbacks: TabBarCallbacks
): TabBarHandle {
  // DOM elements
  const tabBar = container.createDiv('chat-tab-bar');
  const tabsContainer = tabBar.createDiv('chat-tabs-container');

  const newTabBtn = tabBar.createEl('button', {
    cls: 'tab-new-btn',
    attr: { 'aria-label': 'New tab' },
  });
  setIcon(newTabBtn, 'plus');
  newTabBtn.onclick = (): void => callbacks.onNewTab();

  /**
   * Truncate a label to fit display requirements.
   */
  function truncateLabel(label: string): string {
    if (label.length <= MAX_LABEL_LENGTH) {
      return label;
    }
    return label.slice(0, MAX_LABEL_LENGTH) + '...';
  }

  /**
   * Render all tabs in the container.
   */
  function render(): void {
    // Clear existing tabs (but keep structure)
    tabsContainer.empty();

    const tabs = callbacks.getTabs();
    const activeTabId = callbacks.getActiveTabId();

    for (const tab of tabs) {
      const tabEl = tabsContainer.createDiv('chat-tab');
      tabEl.setAttribute('data-tab-id', tab.id);

      if (tab.id === activeTabId) {
        tabEl.addClass('active');
      }

      // Tab label
      const labelEl = tabEl.createSpan('tab-label');
      labelEl.setText(truncateLabel(tab.label));
      labelEl.setAttribute('title', tab.label);

      // Close button
      const closeBtn = tabEl.createSpan('tab-close-btn');
      setIcon(closeBtn, 'x');
      closeBtn.onclick = (e): void => {
        e.stopPropagation();
        callbacks.onTabClose(tab.id);
      };

      // Click to select tab
      tabEl.onclick = (): void => {
        callbacks.onTabSelect(tab.id);
      };

      // Right-click context menu
      tabEl.oncontextmenu = (e): void => {
        e.preventDefault();
        showContextMenu(e, tab);
      };
    }
  }

  /**
   * Show context menu for a tab.
   */
  function showContextMenu(event: MouseEvent, tab: TabInfo): void {
    const menu = new Menu();

    menu.addItem((item) => {
      item
        .setTitle('Rename')
        .setIcon('pencil')
        .onClick(() => {
          const newName = prompt('Enter new tab name:', tab.label);
          if (newName) {
            callbacks.onTabRename(tab.id, newName);
          }
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Close')
        .setIcon('x')
        .onClick(() => {
          callbacks.onTabClose(tab.id);
        });
    });

    menu.showAtMouseEvent(event);
  }

  /**
   * Update the label for a specific tab.
   */
  function updateLabel(tabId: string, label: string): void {
    const tabEl = tabsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!tabEl) return;

    const labelEl = tabEl.querySelector('.tab-label');
    if (labelEl) {
      labelEl.textContent = truncateLabel(label);
      labelEl.setAttribute('title', label);
    }
  }

  /**
   * Set the active tab.
   */
  function setActiveTab(tabId: string): void {
    // Remove active from all tabs
    const allTabs = tabsContainer.querySelectorAll('.chat-tab');
    allTabs.forEach((tab) => tab.classList.remove('active'));

    // Add active to specified tab
    const targetTab = tabsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (targetTab) {
      targetTab.classList.add('active');
    }
  }

  /**
   * Clean up the tab bar.
   */
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
