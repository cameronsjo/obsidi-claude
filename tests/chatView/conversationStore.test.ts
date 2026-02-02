/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  createConversationStore,
  type ConversationStoreHandle,
  type ConversationStoreCallbacks,
} from '../../src/chatView/conversationStore';
import type { ModuleDeps, Conversation, ChatTab } from '../../src/chatView/types';

// Mock logger
vi.mock('../../src/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ConversationStore', () => {
  let deps: ModuleDeps;
  let callbacks: ConversationStoreCallbacks;
  let handle: ConversationStoreHandle;
  let mockStorage: {
    loadConversation: Mock;
    saveConversation: Mock;
    createConversation: Mock;
    deleteConversation: Mock;
    duplicateConversation: Mock;
    renameConversation: Mock;
    togglePin: Mock;
    updateTags: Mock;
    listConversations: Mock;
    getCurrentConversation: Mock;
    setCurrentConversationId: Mock;
    generateTitle: Mock;
  };
  let mockPlugin: {
    storage: typeof mockStorage;
    settings: Record<string, unknown>;
    saveSettings: Mock;
    backendFactory: {
      getBackend: () => { type: string; generateTitle?: Mock };
    };
    conversationStore: {
      list: Mock;
    };
  };

  const mockConversation: Conversation = {
    id: 'conv-1',
    title: 'Test Conversation',
    messages: [
      { id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() },
      { id: 'msg-2', role: 'assistant', content: 'Hi there!', timestamp: Date.now() },
    ],
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now(),
    tags: ['test'],
    pinned: false,
  };

  beforeEach(() => {
    mockStorage = {
      loadConversation: vi.fn().mockResolvedValue(mockConversation),
      saveConversation: vi.fn().mockResolvedValue(undefined),
      createConversation: vi.fn().mockResolvedValue({
        id: 'new-conv',
        title: 'New Conversation',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      deleteConversation: vi.fn().mockResolvedValue(undefined),
      duplicateConversation: vi.fn().mockResolvedValue({
        ...mockConversation,
        id: 'conv-copy',
        title: 'Test Conversation (copy)',
      }),
      renameConversation: vi.fn().mockResolvedValue(undefined),
      togglePin: vi.fn().mockResolvedValue(true),
      updateTags: vi.fn().mockResolvedValue(undefined),
      listConversations: vi.fn().mockResolvedValue([mockConversation]),
      getCurrentConversation: vi.fn().mockResolvedValue(mockConversation),
      setCurrentConversationId: vi.fn().mockResolvedValue(undefined),
      generateTitle: vi.fn((content: string) => content.slice(0, 30)),
    };

    mockPlugin = {
      storage: mockStorage,
      settings: {},
      saveSettings: vi.fn().mockResolvedValue(undefined),
      backendFactory: {
        getBackend: () => ({ type: 'api' }),
      },
      conversationStore: {
        list: vi.fn().mockResolvedValue([mockConversation]),
      },
    };

    deps = {
      app: {} as ModuleDeps['app'],
      plugin: mockPlugin as unknown as ModuleDeps['plugin'],
    };

    callbacks = {
      onConversationChange: vi.fn(),
      onTabsChange: vi.fn(),
      onTitleChange: vi.fn(),
      showStatus: vi.fn(),
      getPlugin: () => mockPlugin as unknown as ModuleDeps['plugin'],
    };

    vi.clearAllMocks();
  });

  describe('creation', () => {
    it('should create a conversation store', () => {
      handle = createConversationStore(deps, callbacks);
      expect(handle).toBeDefined();
      expect(handle.getConversation).toBeDefined();
      expect(handle.save).toBeDefined();
      expect(handle.load).toBeDefined();
    });

    it('should have an initial empty conversation', () => {
      handle = createConversationStore(deps, callbacks);
      const conv = handle.getConversation();
      expect(conv.id).toBeDefined();
      expect(conv.title).toBe('New Conversation');
      expect(conv.messages).toHaveLength(0);
    });
  });

  describe('load', () => {
    it('should load conversation by ID', async () => {
      handle = createConversationStore(deps, callbacks);
      await handle.load('conv-1');

      expect(mockStorage.loadConversation).toHaveBeenCalledWith('conv-1');
      expect(callbacks.onConversationChange).toHaveBeenCalled();
      expect(callbacks.onTitleChange).toHaveBeenCalledWith('Test Conversation');
    });

    it('should load current conversation when no ID provided', async () => {
      handle = createConversationStore(deps, callbacks);
      await handle.load();

      expect(mockStorage.getCurrentConversation).toHaveBeenCalled();
      expect(callbacks.onConversationChange).toHaveBeenCalled();
    });

    it('should show error status on load failure', async () => {
      mockStorage.loadConversation.mockRejectedValue(new Error('Load failed'));
      handle = createConversationStore(deps, callbacks);
      await handle.load('bad-id');

      expect(callbacks.showStatus).toHaveBeenCalledWith('Failed to load conversation', 'error');
    });
  });

  describe('save', () => {
    it('should save the current conversation', async () => {
      handle = createConversationStore(deps, callbacks);
      await handle.load('conv-1');
      await handle.save();

      expect(mockStorage.saveConversation).toHaveBeenCalled();
    });

    it('should auto-generate title for new conversation', async () => {
      // Need at least 2 messages, with a user message but no assistant message
      // to trigger the title generation fallback
      const newConv: Conversation = {
        id: 'new-conv',
        title: 'New Conversation',
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello Claude!', timestamp: Date.now() },
          { id: 'msg-2', role: 'user', content: 'Another message', timestamp: Date.now() },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      mockStorage.getCurrentConversation.mockResolvedValue(newConv);

      handle = createConversationStore(deps, callbacks);
      await handle.load();
      await handle.save();

      expect(mockStorage.generateTitle).toHaveBeenCalledWith('Hello Claude!');
    });
  });

  describe('create', () => {
    it('should create a new conversation', async () => {
      handle = createConversationStore(deps, callbacks);
      const newConv = await handle.create();

      expect(mockStorage.createConversation).toHaveBeenCalled();
      expect(newConv.id).toBe('new-conv');
      expect(callbacks.onConversationChange).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete a conversation', async () => {
      handle = createConversationStore(deps, callbacks);
      await handle.load('conv-1');
      await handle.delete('conv-1');

      expect(mockStorage.deleteConversation).toHaveBeenCalledWith('conv-1');
      expect(callbacks.showStatus).toHaveBeenCalledWith('Conversation deleted', 'success');
    });

    it('should load another conversation after deleting current', async () => {
      mockStorage.listConversations.mockResolvedValue([
        mockConversation,
        { id: 'conv-2', title: 'Other', messages: [], createdAt: 0, updatedAt: 0 },
      ]);

      handle = createConversationStore(deps, callbacks);
      await handle.load('conv-1');
      await handle.delete('conv-1');

      expect(mockStorage.loadConversation).toHaveBeenCalledWith('conv-2');
    });

    it('should create new conversation after deleting last one', async () => {
      mockStorage.listConversations.mockResolvedValue([mockConversation]);

      handle = createConversationStore(deps, callbacks);
      await handle.load('conv-1');
      await handle.delete('conv-1');

      expect(mockStorage.createConversation).toHaveBeenCalled();
    });
  });

  describe('duplicate', () => {
    it('should duplicate a conversation', async () => {
      handle = createConversationStore(deps, callbacks);
      const duplicated = await handle.duplicate('conv-1');

      expect(mockStorage.duplicateConversation).toHaveBeenCalledWith('conv-1');
      expect(duplicated?.id).toBe('conv-copy');
      expect(callbacks.showStatus).toHaveBeenCalledWith('Conversation duplicated', 'success');
    });

    it('should show error if duplication fails', async () => {
      mockStorage.duplicateConversation.mockResolvedValue(null);
      handle = createConversationStore(deps, callbacks);
      const duplicated = await handle.duplicate('bad-id');

      expect(duplicated).toBeNull();
      expect(callbacks.showStatus).toHaveBeenCalledWith('Failed to duplicate conversation', 'error');
    });
  });

  describe('rename', () => {
    it('should rename a conversation', async () => {
      handle = createConversationStore(deps, callbacks);
      await handle.load('conv-1');
      await handle.rename('conv-1', 'New Title');

      expect(mockStorage.renameConversation).toHaveBeenCalledWith('conv-1', 'New Title');
      expect(callbacks.onTitleChange).toHaveBeenCalledWith('New Title');
      expect(callbacks.showStatus).toHaveBeenCalledWith('Conversation renamed', 'success');
    });

    it('should update current conversation title if renaming current', async () => {
      handle = createConversationStore(deps, callbacks);
      await handle.load('conv-1');
      await handle.rename('conv-1', 'New Title');

      expect(handle.getConversation().title).toBe('New Title');
    });
  });

  describe('togglePin', () => {
    it('should toggle pin status', async () => {
      handle = createConversationStore(deps, callbacks);
      await handle.load('conv-1');
      const isPinned = await handle.togglePin('conv-1');

      expect(mockStorage.togglePin).toHaveBeenCalledWith('conv-1');
      expect(isPinned).toBe(true);
      expect(callbacks.showStatus).toHaveBeenCalledWith('Conversation pinned', 'success');
    });

    it('should update current conversation pinned status', async () => {
      handle = createConversationStore(deps, callbacks);
      await handle.load('conv-1');
      await handle.togglePin('conv-1');

      expect(handle.getConversation().pinned).toBe(true);
    });
  });

  describe('tags', () => {
    it('should add a tag', async () => {
      handle = createConversationStore(deps, callbacks);
      await handle.load('conv-1');
      await handle.addTag('new-tag');

      expect(mockStorage.updateTags).toHaveBeenCalledWith('conv-1', ['test', 'new-tag']);
      expect(callbacks.showStatus).toHaveBeenCalledWith('Tag "new-tag" added', 'success');
    });

    it('should not add duplicate tag', async () => {
      handle = createConversationStore(deps, callbacks);
      await handle.load('conv-1');
      await handle.addTag('test');

      expect(mockStorage.updateTags).not.toHaveBeenCalled();
      expect(callbacks.showStatus).toHaveBeenCalledWith('Tag "test" already exists', 'info');
    });

    it('should remove a tag', async () => {
      // Create a fresh conversation with known tags
      const convWithTag: Conversation = {
        ...mockConversation,
        tags: ['test'],
      };
      mockStorage.loadConversation.mockResolvedValue(convWithTag);

      handle = createConversationStore(deps, callbacks);
      await handle.load('conv-1');
      vi.clearAllMocks();  // Clear previous calls

      await handle.removeTag('test');

      expect(mockStorage.updateTags).toHaveBeenCalledWith('conv-1', []);
      expect(callbacks.showStatus).toHaveBeenCalledWith('Tag "test" removed', 'success');
    });

    it('should show info if tag not found', async () => {
      handle = createConversationStore(deps, callbacks);
      await handle.load('conv-1');
      await handle.removeTag('nonexistent');

      expect(callbacks.showStatus).toHaveBeenCalledWith('Tag "nonexistent" not found', 'info');
    });
  });

  describe('tab management', () => {
    it('should initialize tabs', () => {
      handle = createConversationStore(deps, callbacks);
      handle.initializeTabs();

      const tabs = handle.getTabs();
      expect(tabs.length).toBeGreaterThan(0);
      expect(handle.getActiveTabId()).not.toBeNull();
    });

    it('should load saved tabs from settings', () => {
      const savedTabs: ChatTab[] = [
        { id: 'tab-1', conversationId: 'conv-1', label: 'Tab 1' },
        { id: 'tab-2', conversationId: 'conv-2', label: 'Tab 2' },
      ];
      mockPlugin.settings = {
        savedTabs,
        activeTabId: 'tab-2',
      };

      handle = createConversationStore(deps, callbacks);
      handle.initializeTabs();

      expect(handle.getTabs()).toHaveLength(2);
      expect(handle.getActiveTabId()).toBe('tab-2');
    });

    it('should create a new tab', async () => {
      handle = createConversationStore(deps, callbacks);
      handle.initializeTabs();
      const initialCount = handle.getTabs().length;

      const newTab = await handle.createTab();

      expect(handle.getTabs().length).toBe(initialCount + 1);
      expect(newTab.label).toBe('New Chat');
      expect(handle.getActiveTabId()).toBe(newTab.id);
    });

    it('should switch tabs', async () => {
      const savedTabs: ChatTab[] = [
        { id: 'tab-1', conversationId: 'conv-1', label: 'Tab 1' },
        { id: 'tab-2', conversationId: 'conv-2', label: 'Tab 2' },
      ];
      mockPlugin.settings = { savedTabs, activeTabId: 'tab-1' };

      handle = createConversationStore(deps, callbacks);
      handle.initializeTabs();

      await handle.switchTab('tab-2');

      expect(handle.getActiveTabId()).toBe('tab-2');
      expect(callbacks.onConversationChange).toHaveBeenCalled();
    });

    it('should not switch to already active tab', async () => {
      const savedTabs: ChatTab[] = [
        { id: 'tab-1', conversationId: 'conv-1', label: 'Tab 1' },
      ];
      mockPlugin.settings = { savedTabs, activeTabId: 'tab-1' };

      handle = createConversationStore(deps, callbacks);
      handle.initializeTabs();
      vi.clearAllMocks();

      await handle.switchTab('tab-1');

      expect(callbacks.onConversationChange).not.toHaveBeenCalled();
    });

    it('should close a tab', async () => {
      const savedTabs: ChatTab[] = [
        { id: 'tab-1', conversationId: 'conv-1', label: 'Tab 1' },
        { id: 'tab-2', conversationId: 'conv-2', label: 'Tab 2' },
      ];
      mockPlugin.settings = { savedTabs, activeTabId: 'tab-1' };

      handle = createConversationStore(deps, callbacks);
      handle.initializeTabs();

      await handle.closeTab('tab-2');

      expect(handle.getTabs()).toHaveLength(1);
    });

    it('should not close the last tab', async () => {
      const savedTabs: ChatTab[] = [
        { id: 'tab-1', conversationId: 'conv-1', label: 'Tab 1' },
      ];
      mockPlugin.settings = { savedTabs, activeTabId: 'tab-1' };

      handle = createConversationStore(deps, callbacks);
      handle.initializeTabs();

      await handle.closeTab('tab-1');

      expect(handle.getTabs()).toHaveLength(1);
    });

    it('should switch to adjacent tab when closing active tab', async () => {
      const savedTabs: ChatTab[] = [
        { id: 'tab-1', conversationId: 'conv-1', label: 'Tab 1' },
        { id: 'tab-2', conversationId: 'conv-2', label: 'Tab 2' },
      ];
      mockPlugin.settings = { savedTabs, activeTabId: 'tab-1' };

      handle = createConversationStore(deps, callbacks);
      handle.initializeTabs();

      await handle.closeTab('tab-1');

      expect(handle.getActiveTabId()).toBe('tab-2');
    });

    it('should pin a tab', async () => {
      const savedTabs: ChatTab[] = [
        { id: 'tab-1', conversationId: 'conv-1', label: 'Tab 1' },
      ];
      mockPlugin.settings = { savedTabs, activeTabId: 'tab-1' };

      handle = createConversationStore(deps, callbacks);
      handle.initializeTabs();

      await handle.pinTab('tab-1');

      expect(handle.getTabs()[0].pinned).toBe(true);
    });

    it('should duplicate a tab', () => {
      const savedTabs: ChatTab[] = [
        { id: 'tab-1', conversationId: 'conv-1', label: 'Tab 1' },
      ];
      mockPlugin.settings = { savedTabs, activeTabId: 'tab-1' };

      handle = createConversationStore(deps, callbacks);
      handle.initializeTabs();

      handle.duplicateTab('tab-1');

      expect(handle.getTabs()).toHaveLength(2);
      expect(handle.getTabs()[1].label).toBe('Tab 1 (copy)');
    });

    it('should rename a tab', () => {
      // Deep clone the tabs to prevent mutation issues
      const savedTabs: ChatTab[] = [
        { id: 'tab-1', conversationId: 'conv-1', label: 'Tab 1' },
      ];
      mockPlugin.settings = {
        savedTabs: JSON.parse(JSON.stringify(savedTabs)),
        activeTabId: 'tab-1',
      };

      handle = createConversationStore(deps, callbacks);
      handle.initializeTabs();
      vi.clearAllMocks();  // Clear initialization calls

      handle.renameTab('tab-1', 'Renamed Tab');

      expect(handle.getTabs()[0].label).toBe('Renamed Tab');
      expect(callbacks.onTabsChange).toHaveBeenCalled();
    });

    it('should close other tabs', async () => {
      const savedTabs: ChatTab[] = [
        { id: 'tab-1', conversationId: 'conv-1', label: 'Tab 1' },
        { id: 'tab-2', conversationId: 'conv-2', label: 'Tab 2' },
        { id: 'tab-3', conversationId: 'conv-3', label: 'Tab 3', pinned: true },
      ];
      mockPlugin.settings = { savedTabs, activeTabId: 'tab-1' };

      handle = createConversationStore(deps, callbacks);
      handle.initializeTabs();

      await handle.closeOtherTabs('tab-1');

      // Only tab-1 and tab-3 (pinned) should remain
      expect(handle.getTabs()).toHaveLength(2);
      expect(handle.getTabs().map((t) => t.id)).toContain('tab-1');
      expect(handle.getTabs().map((t) => t.id)).toContain('tab-3');
    });

    it('should save tab state', async () => {
      handle = createConversationStore(deps, callbacks);
      handle.initializeTabs();

      await handle.saveTabState();

      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.settings.savedTabs).toBeDefined();
      expect(mockPlugin.settings.activeTabId).toBeDefined();
    });

    it('should update active tab label', async () => {
      // Deep clone to prevent mutation issues
      const savedTabs: ChatTab[] = [
        { id: 'tab-1', conversationId: 'conv-1', label: 'Tab 1' },
      ];
      mockPlugin.settings = {
        savedTabs: JSON.parse(JSON.stringify(savedTabs)),
        activeTabId: 'tab-1',
      };

      // Ensure mockConversation is fresh
      mockStorage.loadConversation.mockResolvedValue({
        ...mockConversation,
        title: 'Test Conversation',
      });

      handle = createConversationStore(deps, callbacks);
      handle.initializeTabs();
      await handle.load('conv-1');
      vi.clearAllMocks();  // Clear load calls

      handle.updateActiveTabLabel();

      expect(handle.getTabs()[0].label).toBe('Test Conversation');
      expect(callbacks.onTabsChange).toHaveBeenCalled();
    });

    it('should toggle tabs enabled state', () => {
      handle = createConversationStore(deps, callbacks);
      expect(handle.isTabsEnabled()).toBe(true);

      handle.setTabsEnabled(false);
      expect(handle.isTabsEnabled()).toBe(false);
    });
  });

  describe('clearMessages', () => {
    it('should clear all messages', async () => {
      handle = createConversationStore(deps, callbacks);
      await handle.load('conv-1');

      await handle.clearMessages();

      expect(handle.getConversation().messages).toHaveLength(0);
      expect(callbacks.onConversationChange).toHaveBeenCalled();
      expect(callbacks.showStatus).toHaveBeenCalledWith('Messages cleared', 'info');
    });

    it('should clear session ID when clearing messages', async () => {
      const convWithSession = {
        ...mockConversation,
        sessionId: 'session-123',
      };
      mockStorage.loadConversation.mockResolvedValue(convWithSession);

      handle = createConversationStore(deps, callbacks);
      await handle.load('conv-1');

      await handle.clearMessages();

      expect(handle.getConversation().sessionId).toBeUndefined();
    });
  });

  describe('updateSessionId', () => {
    it('should update session ID', async () => {
      handle = createConversationStore(deps, callbacks);
      await handle.load('conv-1');

      handle.updateSessionId('new-session-id');

      const conv = handle.getConversation();
      expect(conv.sessionId).toBe('new-session-id');
      expect(conv.metadata?.sessionId).toBe('new-session-id');
    });

    it('should create metadata if not present', () => {
      handle = createConversationStore(deps, callbacks);

      handle.updateSessionId('session-123');

      const conv = handle.getConversation();
      expect(conv.metadata).toBeDefined();
      expect(conv.metadata?.sessionId).toBe('session-123');
    });
  });

  describe('generateTitle', () => {
    it('should generate smart title using backend', async () => {
      const mockGenerateTitle = vi.fn().mockResolvedValue('Smart Generated Title');
      mockPlugin.backendFactory.getBackend = () => ({
        type: 'api',
        generateTitle: mockGenerateTitle,
      });

      handle = createConversationStore(deps, callbacks);

      await handle.generateTitle('Hello', 'Hi there');

      expect(mockGenerateTitle).toHaveBeenCalledWith('Hello', 'Hi there');
      expect(callbacks.onTitleChange).toHaveBeenCalledWith('Smart Generated Title');
    });

    it('should fall back to storage title generation if smart fails', async () => {
      const mockGenerateTitle = vi.fn().mockRejectedValue(new Error('Failed'));
      mockPlugin.backendFactory.getBackend = () => ({
        type: 'api',
        generateTitle: mockGenerateTitle,
      });

      handle = createConversationStore(deps, callbacks);

      await handle.generateTitle('Hello world', 'Response');

      expect(mockStorage.generateTitle).toHaveBeenCalledWith('Hello world');
    });

    it('should use storage title generation if backend has no generateTitle', async () => {
      mockPlugin.backendFactory.getBackend = () => ({
        type: 'api',
      });

      handle = createConversationStore(deps, callbacks);

      await handle.generateTitle('Hello world', 'Response');

      expect(mockStorage.generateTitle).toHaveBeenCalledWith('Hello world');
    });
  });

  describe('destruction', () => {
    it('should clean up on destroy', () => {
      handle = createConversationStore(deps, callbacks);
      expect(() => handle.destroy()).not.toThrow();
    });
  });
});
