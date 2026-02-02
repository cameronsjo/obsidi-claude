/**
 * Conversation store module for ChatView.
 * Handles conversation CRUD operations, tab management, and persistence.
 */
import type { ModuleDeps, ModuleHandle, Conversation, ChatTab } from './types';
import { generateId, calculateConversationUsage } from '../types';
import { createLogger } from '../logger';

const log = createLogger('ConversationStore');

/**
 * Callbacks for conversation store to communicate with parent.
 */
export interface ConversationStoreCallbacks {
  onConversationChange: (conv: Conversation) => void;
  onTabsChange: (tabs: ChatTab[]) => void;
  onTitleChange: (title: string) => void;
  showStatus: (msg: string, type: 'info' | 'error' | 'success') => void;
  getPlugin: () => ModuleDeps['plugin'];
}

/**
 * Handle for controlling the conversation store.
 */
export interface ConversationStoreHandle extends ModuleHandle {
  /** Get the current conversation */
  getConversation(): Conversation;
  /** Set the current conversation directly */
  setConversation(conv: Conversation): void;
  /** Load a conversation by ID or load current */
  load(id?: string): Promise<void>;
  /** Save the current conversation */
  save(): Promise<void>;
  /** Create a new conversation */
  create(): Promise<Conversation>;
  /** Delete a conversation by ID */
  delete(id: string): Promise<void>;
  /** Duplicate a conversation by ID */
  duplicate(id: string): Promise<Conversation | null>;
  /** Rename a conversation */
  rename(id: string, title: string): Promise<void>;
  /** Toggle pin status */
  togglePin(id: string): Promise<boolean>;
  /** Add a tag to the current conversation */
  addTag(tag: string): Promise<void>;
  /** Remove a tag from the current conversation */
  removeTag(tag: string): Promise<void>;
  /** Update tags for a conversation */
  updateTags(id: string, tags: string[]): Promise<void>;
  /** Generate a smart title for the conversation */
  generateTitle(userMessage: string, assistantMessage: string): Promise<void>;
  /** Get all tabs */
  getTabs(): ChatTab[];
  /** Get the active tab ID */
  getActiveTabId(): string | null;
  /** Switch to a tab by ID */
  switchTab(id: string): Promise<void>;
  /** Close a tab by ID */
  closeTab(id: string): Promise<void>;
  /** Create a new tab */
  createTab(): Promise<ChatTab>;
  /** Pin/unpin a tab */
  pinTab(id: string): Promise<void>;
  /** Duplicate a tab */
  duplicateTab(id: string): void;
  /** Close all tabs except the specified one */
  closeOtherTabs(id: string): Promise<void>;
  /** Rename a tab */
  renameTab(id: string, label: string): void;
  /** Set whether tabs are enabled */
  setTabsEnabled(enabled: boolean): void;
  /** Check if tabs are enabled */
  isTabsEnabled(): boolean;
  /** Save tab state to settings */
  saveTabState(): Promise<void>;
  /** Initialize tabs from saved state */
  initializeTabs(): void;
  /** Update the active tab label from current conversation */
  updateActiveTabLabel(): void;
  /** Clear all messages in current conversation */
  clearMessages(): Promise<void>;
  /** Update session ID from backend */
  updateSessionId(sessionId: string | undefined): void;
}

/**
 * Create a conversation store for managing conversations and tabs.
 * @param deps - Module dependencies
 * @param callbacks - Callbacks for parent communication
 */
export function createConversationStore(
  deps: ModuleDeps,
  callbacks: ConversationStoreCallbacks
): ConversationStoreHandle {
  // Get plugin reference immediately
  const plugin = callbacks.getPlugin();

  /**
   * Create an empty conversation with default values.
   */
  function createEmptyConversation(): Conversation {
    const backend = plugin.backendFactory?.getBackend();
    const backendType = backend?.type ?? 'api';

    return {
      id: generateId(),
      title: 'New Conversation',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        backendType,
      },
    };
  }

  // State - now createEmptyConversation can access plugin
  let conversation: Conversation = createEmptyConversation();
  let tabs: ChatTab[] = [];
  let activeTabId: string | null = null;
  let tabsEnabled = true;

  /**
   * Get the current conversation.
   */
  function getConversation(): Conversation {
    return conversation;
  }

  /**
   * Set the current conversation directly.
   */
  function setConversation(conv: Conversation): void {
    conversation = conv;
  }

  /**
   * Load a conversation by ID or load the current one.
   */
  async function load(id?: string): Promise<void> {
    try {
      if (id) {
        const loaded = await plugin.storage.loadConversation(id);
        if (loaded) {
          conversation = loaded;
          await plugin.storage.setCurrentConversationId(id);
        }
      } else {
        conversation = await plugin.storage.getCurrentConversation();
      }
      callbacks.onConversationChange(conversation);
      callbacks.onTitleChange(conversation.title);
      log.debug('Conversation loaded', {
        id: conversation.id,
        messageCount: conversation.messages.length,
      });
    } catch (error) {
      log.error('Failed to load conversation', error);
      callbacks.showStatus('Failed to load conversation', 'error');
    }
  }

  /**
   * Save the current conversation.
   */
  async function save(): Promise<void> {
    // Auto-generate title after first exchange if still default
    if (
      conversation.title === 'New Conversation' &&
      conversation.messages.length >= 2
    ) {
      const firstUserMsg = conversation.messages.find((m) => m.role === 'user');
      const firstAssistantMsg = conversation.messages.find((m) => m.role === 'assistant');

      if (firstUserMsg && !firstAssistantMsg) {
        // Fallback to simple truncation if no assistant message yet
        conversation.title = plugin.storage.generateTitle(firstUserMsg.content);
        callbacks.onTitleChange(conversation.title);
      }
    }

    conversation.updatedAt = Date.now();
    await plugin.storage.saveConversation(conversation);
    log.debug('Conversation saved', { id: conversation.id });
  }

  /**
   * Create a new conversation.
   */
  async function create(): Promise<Conversation> {
    log.info('Creating new conversation');
    conversation = await plugin.storage.createConversation();
    callbacks.onConversationChange(conversation);
    callbacks.onTitleChange(conversation.title);
    return conversation;
  }

  /**
   * Delete a conversation by ID.
   */
  async function deleteConversation(id: string): Promise<void> {
    const conversations = await plugin.storage.listConversations();
    const isCurrentConv = id === conversation.id;

    await plugin.storage.deleteConversation(id);
    callbacks.showStatus('Conversation deleted', 'success');

    if (isCurrentConv) {
      // Load another conversation or create new
      const remaining = conversations.filter((c) => c.id !== id);
      if (remaining.length > 0) {
        await load(remaining[0].id);
      } else {
        await create();
      }
    }

    log.info('Conversation deleted', { id });
  }

  /**
   * Duplicate a conversation by ID.
   */
  async function duplicate(id: string): Promise<Conversation | null> {
    const newConv = await plugin.storage.duplicateConversation(id);
    if (newConv) {
      callbacks.showStatus('Conversation duplicated', 'success');
      log.info('Conversation duplicated', { originalId: id, newId: newConv.id });
    } else {
      callbacks.showStatus('Failed to duplicate conversation', 'error');
    }
    return newConv;
  }

  /**
   * Rename a conversation.
   */
  async function rename(id: string, title: string): Promise<void> {
    await plugin.storage.renameConversation(id, title);
    callbacks.showStatus('Conversation renamed', 'success');

    if (conversation.id === id) {
      conversation.title = title;
      callbacks.onTitleChange(title);
    }

    log.info('Conversation renamed', { id, title });
  }

  /**
   * Toggle pin status for a conversation.
   */
  async function togglePin(id: string): Promise<boolean> {
    const isPinned = await plugin.storage.togglePin(id);
    callbacks.showStatus(isPinned ? 'Conversation pinned' : 'Conversation unpinned', 'success');

    if (conversation.id === id) {
      conversation.pinned = isPinned;
    }

    return isPinned;
  }

  /**
   * Add a tag to the current conversation.
   */
  async function addTag(tag: string): Promise<void> {
    const tags = conversation.tags || [];
    if (!tags.includes(tag)) {
      tags.push(tag);
      conversation.tags = tags;
      await plugin.storage.updateTags(conversation.id, tags);
      callbacks.showStatus(`Tag "${tag}" added`, 'success');
    } else {
      callbacks.showStatus(`Tag "${tag}" already exists`, 'info');
    }
  }

  /**
   * Remove a tag from the current conversation.
   */
  async function removeTag(tag: string): Promise<void> {
    const tags = conversation.tags || [];
    const index = tags.indexOf(tag);
    if (index >= 0) {
      tags.splice(index, 1);
      conversation.tags = tags;
      await plugin.storage.updateTags(conversation.id, tags);
      callbacks.showStatus(`Tag "${tag}" removed`, 'success');
    } else {
      callbacks.showStatus(`Tag "${tag}" not found`, 'info');
    }
  }

  /**
   * Update tags for a conversation.
   */
  async function updateTags(id: string, tagList: string[]): Promise<void> {
    await plugin.storage.updateTags(id, tagList);
    if (conversation.id === id) {
      conversation.tags = tagList;
    }
  }

  /**
   * Generate a smart title for the conversation.
   */
  async function generateTitle(userMessage: string, assistantMessage: string): Promise<void> {
    const backend = plugin.backendFactory?.getBackend();

    // Try smart generation if backend supports it
    if (backend?.generateTitle) {
      try {
        const smartTitle = await backend.generateTitle(userMessage, assistantMessage);
        if (smartTitle && conversation.title === 'New Conversation') {
          conversation.title = smartTitle;
          callbacks.onTitleChange(conversation.title);
          await plugin.storage.saveConversation(conversation);
          log.debug('Generated smart title', { title: smartTitle });
          return;
        }
      } catch (error) {
        log.debug('Smart title generation failed, using fallback', error);
      }
    }

    // Fallback to simple truncation
    if (conversation.title === 'New Conversation') {
      conversation.title = plugin.storage.generateTitle(userMessage);
      callbacks.onTitleChange(conversation.title);
    }
  }

  // ===== Tab Management =====

  /**
   * Get all tabs.
   */
  function getTabs(): ChatTab[] {
    return tabs;
  }

  /**
   * Get the active tab ID.
   */
  function getActiveTabId(): string | null {
    return activeTabId;
  }

  /**
   * Initialize tabs from saved state.
   */
  function initializeTabs(): void {
    const savedTabs = plugin.settings.savedTabs as ChatTab[] | undefined;
    const savedActiveTabId = plugin.settings.activeTabId as string | undefined;

    if (savedTabs && savedTabs.length > 0) {
      tabs = savedTabs;
      activeTabId = savedActiveTabId || savedTabs[0].id;
    } else {
      // Create initial tab for current conversation
      const initialTab: ChatTab = {
        id: generateId(),
        conversationId: conversation?.id || '',
        label: conversation?.title || 'New Chat',
      };
      tabs = [initialTab];
      activeTabId = initialTab.id;
    }
    log.debug('Tabs initialized', { count: tabs.length, activeTabId });
  }

  /**
   * Switch to a different tab.
   */
  async function switchTab(tabId: string): Promise<void> {
    if (tabId === activeTabId) return;

    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    log.info('Switching tab', { fromTabId: activeTabId, toTabId: tabId });

    // Save current conversation before switching
    await save();

    // Update active tab
    activeTabId = tabId;

    // Load the conversation for this tab
    const conversations = await plugin.conversationStore.list();
    const targetConversation = conversations.find((c) => c.id === tab.conversationId);

    if (targetConversation) {
      conversation = targetConversation;
    } else {
      // Create new conversation if not found
      conversation = {
        id: tab.conversationId || generateId(),
        title: 'New Chat',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      tab.conversationId = conversation.id;
    }

    callbacks.onConversationChange(conversation);
    callbacks.onTitleChange(conversation.title);
    callbacks.onTabsChange(tabs);
    await saveTabState();
  }

  /**
   * Create a new tab with a fresh conversation.
   */
  async function createTab(): Promise<ChatTab> {
    log.info('Creating new tab');

    // Save current conversation
    await save();

    // Create new conversation
    const newConversation: Conversation = {
      id: generateId(),
      title: 'New Chat',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Create new tab
    const newTab: ChatTab = {
      id: generateId(),
      conversationId: newConversation.id,
      label: 'New Chat',
    };

    tabs.push(newTab);
    activeTabId = newTab.id;
    conversation = newConversation;

    callbacks.onConversationChange(conversation);
    callbacks.onTitleChange(conversation.title);
    callbacks.onTabsChange(tabs);
    await saveTabState();

    return newTab;
  }

  /**
   * Close a tab.
   */
  async function closeTab(tabId: string): Promise<void> {
    if (tabs.length <= 1) return; // Don't close last tab

    const tabIndex = tabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return;

    log.info('Closing tab', { tabId });

    // Remove tab
    tabs.splice(tabIndex, 1);

    // If we closed the active tab, switch to adjacent one
    if (tabId === activeTabId) {
      const newIndex = Math.min(tabIndex, tabs.length - 1);
      await switchTab(tabs[newIndex].id);
    } else {
      callbacks.onTabsChange(tabs);
      await saveTabState();
    }
  }

  /**
   * Pin/unpin a tab.
   */
  async function pinTab(tabId: string): Promise<void> {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.pinned = !tab.pinned;
      callbacks.onTabsChange(tabs);
      await saveTabState();
    }
  }

  /**
   * Duplicate a tab.
   */
  function duplicateTab(tabId: string): void {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) {
      const newTab: ChatTab = {
        id: generateId(),
        conversationId: tab.conversationId,
        label: `${tab.label} (copy)`,
      };
      tabs.push(newTab);
      callbacks.onTabsChange(tabs);
      saveTabState();
    }
  }

  /**
   * Close all tabs except the specified one.
   */
  async function closeOtherTabs(tabId: string): Promise<void> {
    const otherTabs = tabs.filter((t) => t.id !== tabId && !t.pinned);
    for (const other of otherTabs) {
      await closeTab(other.id);
    }
  }

  /**
   * Rename a tab.
   */
  function renameTab(tabId: string, label: string): void {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.label = label;
      callbacks.onTabsChange(tabs);
      // Save without overwriting the label we just set
      saveTabsToSettings();
    }
  }

  /**
   * Save tabs to settings without updating labels from conversation.
   * Used when we've explicitly set tab labels and don't want them overwritten.
   */
  async function saveTabsToSettings(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (plugin.settings as any).savedTabs = tabs;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (plugin.settings as any).activeTabId = activeTabId;
    await plugin.saveSettings();
    log.debug('Tabs saved to settings', { tabs: tabs.length, activeTabId });
  }

  /**
   * Set whether tabs are enabled.
   */
  function setTabsEnabled(enabled: boolean): void {
    tabsEnabled = enabled;
  }

  /**
   * Check if tabs are enabled.
   */
  function isTabsEnabled(): boolean {
    return tabsEnabled;
  }

  /**
   * Save tab state to plugin settings.
   */
  async function saveTabState(): Promise<void> {
    // Update tab labels from current conversation
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab && conversation) {
      activeTab.label = conversation.title;
      activeTab.conversationId = conversation.id;
    }

    // Save to plugin settings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (plugin.settings as any).savedTabs = tabs;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (plugin.settings as any).activeTabId = activeTabId;
    await plugin.saveSettings();
    log.debug('Tab state saved', { tabs: tabs.length, activeTabId });
  }

  /**
   * Update the active tab's label when conversation title changes.
   */
  function updateActiveTabLabel(): void {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab && conversation) {
      activeTab.label = conversation.title;
      callbacks.onTabsChange(tabs);
    }
  }

  /**
   * Clear all messages in the current conversation.
   */
  async function clearMessages(): Promise<void> {
    log.info('Clearing messages', { conversationId: conversation.id });
    conversation.messages = [];
    conversation.sessionId = undefined;
    await save();
    callbacks.onConversationChange(conversation);
    callbacks.showStatus('Messages cleared', 'info');
  }

  /**
   * Update session ID from backend.
   */
  function updateSessionId(sessionId: string | undefined): void {
    const backend = plugin.backendFactory?.getBackend();
    if (sessionId) {
      conversation.sessionId = sessionId;
      if (!conversation.metadata) {
        conversation.metadata = { backendType: backend?.type ?? 'api' };
      }
      conversation.metadata.sessionId = sessionId;
    }
  }

  /**
   * Clean up the conversation store.
   */
  function destroy(): void {
    // Nothing to clean up for this module
    log.debug('ConversationStore destroyed');
  }

  return {
    getConversation,
    setConversation,
    load,
    save,
    create,
    delete: deleteConversation,
    duplicate,
    rename,
    togglePin,
    addTag,
    removeTag,
    updateTags,
    generateTitle,
    getTabs,
    getActiveTabId,
    switchTab,
    closeTab,
    createTab,
    pinTab,
    duplicateTab,
    closeOtherTabs,
    renameTab,
    setTabsEnabled,
    isTabsEnabled,
    saveTabState,
    initializeTabs,
    updateActiveTabLabel,
    clearMessages,
    updateSessionId,
    destroy,
  };
}
