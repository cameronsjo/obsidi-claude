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
  pinned?: boolean;
  linkedPath?: string;
}

/**
 * Callbacks for tab bar to communicate with parent.
 */
export interface TabBarCallbacks {
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
  onTabRename: (tabId: string, newLabel: string) => void;
  onTabPin: (tabId: string, pinned: boolean) => void;
  onTabDuplicate: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
  getTabs: () => TabInfo[];
  getActiveTabId: () => string | null;
  getTabCount: () => number;
}

/**
 * Handle for controlling the tab bar.
 */
export interface TabBarHandle extends ModuleHandle {
  render(): void;
  updateLabel(tabId: string, label: string): void;
  setActiveTab(tabId: string): void;
  setVisible(visible: boolean): void;
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
  // DOM elements - use the container directly as the tab bar
  container.addClass('chat-tab-bar');
  const tabsContainer = container.createDiv('chat-tabs-container');

  const newTabBtn = container.createDiv('chat-tab-new');
  setIcon(newTabBtn, 'plus');
  newTabBtn.setAttribute('aria-label', 'New tab');
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
   * Set tab bar visibility.
   */
  function setVisible(visible: boolean): void {
    container.style.display = visible ? 'flex' : 'none';
  }

  /**
   * Render all tabs in the container.
   */
  function render(): void {
    // Clear existing tabs (but keep structure)
    tabsContainer.empty();

    const tabs = callbacks.getTabs();
    const activeTabId = callbacks.getActiveTabId();
    const tabCount = callbacks.getTabCount();

    for (const tab of tabs) {
      const tabEl = tabsContainer.createDiv({
        cls: `chat-tab ${tab.id === activeTabId ? 'chat-tab-active' : ''}`,
      });
      tabEl.setAttribute('data-tab-id', tab.id);

      // Tab icon for pinned/linked
      if (tab.pinned) {
        const pinIcon = tabEl.createSpan('chat-tab-icon');
        setIcon(pinIcon, 'pin');
      } else if (tab.linkedPath) {
        const linkIcon = tabEl.createSpan('chat-tab-icon');
        setIcon(linkIcon, 'link');
      }

      // Tab label
      const labelEl = tabEl.createSpan('chat-tab-label');
      labelEl.setText(truncateLabel(tab.label));
      labelEl.setAttribute('title', tab.label);

      // Click to select tab
      tabEl.onclick = (e): void => {
        e.stopPropagation();
        callbacks.onTabSelect(tab.id);
      };

      // Close button (unless pinned or only one tab)
      if (!tab.pinned && tabCount > 1) {
        const closeBtn = tabEl.createSpan('chat-tab-close');
        setIcon(closeBtn, 'x');
        closeBtn.onclick = (e): void => {
          e.stopPropagation();
          callbacks.onTabClose(tab.id);
        };
      }

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
    const tabCount = callbacks.getTabCount();

    menu.addItem((item) => {
      item
        .setTitle(tab.pinned ? 'Unpin tab' : 'Pin tab')
        .setIcon('pin')
        .onClick(() => {
          callbacks.onTabPin(tab.id, !tab.pinned);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Rename tab')
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
        .setTitle('Duplicate tab')
        .setIcon('copy')
        .onClick(() => {
          callbacks.onTabDuplicate(tab.id);
        });
    });

    if (!tab.pinned && tabCount > 1) {
      menu.addSeparator();
      menu.addItem((item) => {
        item
          .setTitle('Close tab')
          .setIcon('x')
          .onClick(() => {
            callbacks.onTabClose(tab.id);
          });
      });

      menu.addItem((item) => {
        item
          .setTitle('Close other tabs')
          .setIcon('x-circle')
          .onClick(() => {
            callbacks.onCloseOtherTabs(tab.id);
          });
      });
    }

    menu.showAtMouseEvent(event);
  }

  /**
   * Update the label for a specific tab.
   */
  function updateLabel(tabId: string, label: string): void {
    const tabEl = tabsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!tabEl) return;

    const labelEl = tabEl.querySelector('.chat-tab-label');
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
    allTabs.forEach((tab) => tab.classList.remove('chat-tab-active'));

    // Add active to specified tab
    const targetTab = tabsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (targetTab) {
      targetTab.classList.add('chat-tab-active');
    }
  }

  /**
   * Clean up the tab bar.
   */
  function destroy(): void {
    tabsContainer.remove();
    newTabBtn.remove();
    container.removeClass('chat-tab-bar');
  }

  return {
    render,
    updateLabel,
    setActiveTab,
    setVisible,
    destroy,
  };
}
