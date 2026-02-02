import {
  ItemView,
  WorkspaceLeaf,
  MarkdownRenderer,
  MarkdownView,
  Component,
  setIcon,
  Notice,
  Menu,
} from 'obsidian';
import { PermissionModal } from './chatViewModals';
import { executeCommand, getCommandList, type ChatViewCommandContext } from './chatViewCommands';
import type ObsidiClaudePlugin from '../main';
import type { ChatMessage, ToolCallInfo, Conversation, MessageUsage, ChatTab } from './types';
import { generateId, calculateCost, calculateConversationUsage } from './types';
import type { AgentBackend, AgentCallbacks, AgentResult } from './backends';
import type { PermissionRequestContext, PermissionResponse } from './backends/sdkAgentBackend';
import { createLogger } from './logger';

// Import extracted UI modules
import {
  createSearchBar,
  createQueuePanel,
  createStatusBar,
  createMobileSupport,
  createTabBar,
  createMessageRenderer,
  createInputArea,
  createHistoryPanel,
  createMessageOrchestrator,
  createSlashCommands,
  createContextLoader,
  createConversationStore,
  type SearchBarHandle,
  type QueuePanelHandle,
  type StatusBarHandle,
  type StatusBarContainers,
  type MobileSupportHandle,
  type TabBarHandle,
  type MessageRendererHandle,
  type InputAreaHandle,
  type HistoryPanelHandle,
  type MessageOrchestratorHandle,
  type SlashCommandsHandle,
  type ContextLoaderHandle,
  type ContextInfo,
  type ConversationStoreHandle,
} from './chatView/index';

const log = createLogger('ChatView');

// UI Configuration Constants
const SCROLL_THRESHOLD_PX = 100;
const MAX_TEXTAREA_HEIGHT_PX = 180;
const CHARS_PER_TOKEN_ESTIMATE = 4;

// Tool status to icon mapping
const TOOL_STATUS_ICONS: Record<ToolCallInfo['status'], string> = {
  completed: 'check-circle',
  running: 'loader',
  error: 'x-circle',
  pending: 'circle',
};

export const CHAT_VIEW_TYPE = 'obsidi-claude-chat';

export class ChatView extends ItemView {
  plugin: ObsidiClaudePlugin;

  // UI elements
  private messagesContainer: HTMLElement;
  private statusEl: HTMLElement;
  private chatTitleEl: HTMLElement;
  private searchContainer: HTMLElement;

  // Backward compat references to input area elements (from module)
  private inputEl!: HTMLTextAreaElement;
  private inputWrapper!: HTMLElement;

  // State
  private conversation: Conversation;
  private isProcessing = false;
  private messageElements: Map<string, HTMLElement> = new Map();
  private searchVisible = false;
  private userScrolledUp = false;
  private vaultRefreshTimeout: ReturnType<typeof setTimeout> | null = null;

  // Voice input state
  private isRecording = false;
  private speechRecognition: SpeechRecognition | null = null;

  // Message queue container (UI created by module)
  private queueContainer: HTMLElement;

  // Tab management
  private tabs: ChatTab[] = [];
  private activeTabId: string | null = null;
  private tabsEnabled = true; // Can be disabled via settings

  // Scroll to bottom button
  private scrollToBottomBtn: HTMLElement | null = null;

  // Command autocomplete
  private autocompleteEl: HTMLElement | null = null;
  private autocompleteIndex = -1;
  private autocompleteCommands: Array<{ name: string; description: string }> = [];

  // Extracted UI module handles
  private searchBarModule: SearchBarHandle | null = null;
  private queueModule: QueuePanelHandle | null = null;
  private statusModule: StatusBarHandle | null = null;
  private mobileModule: MobileSupportHandle | null = null;
  private tabModule: TabBarHandle | null = null;
  private messageModule: MessageRendererHandle | null = null;
  private inputModule: InputAreaHandle | null = null;
  private historyModule: HistoryPanelHandle | null = null;
  private messageOrchestrator: MessageOrchestratorHandle | null = null;
  private slashCommandsModule: SlashCommandsHandle | null = null;
  private contextModule: ContextLoaderHandle | null = null;

  // Container references for deferred module initialization
  private statusBadgesContainer: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidiClaudePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.conversation = this.createNewConversation();
  }

  /**
   * Get the current agent backend from the factory.
   */
  private getBackend(): AgentBackend {
    return this.plugin.backendFactory.getBackend();
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Claude Chat';
  }

  getIcon(): string {
    return 'message-circle';
  }

  async onOpen(): Promise<void> {
    log.info('Opening chat view');
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('obsidi-claude-container');

    // Create module dependencies
    const deps = { app: this.plugin.app, plugin: this.plugin };

    // Header
    const header = container.createDiv('chat-header');
    this.createHeader(header);

    // Tab bar (below header) - use module
    const tabBarContainer = container.createDiv();
    this.initializeTabs();
    this.tabModule = createTabBar(tabBarContainer, deps, {
      onTabSelect: (tabId) => this.switchToTab(tabId),
      onTabClose: (tabId) => this.closeTab(tabId),
      onNewTab: () => this.createNewTab(),
      onTabRename: (tabId, newLabel) => {
        const tab = this.tabs.find(t => t.id === tabId);
        if (tab) {
          tab.label = newLabel;
          this.tabModule?.render();
          this.saveTabState();
        }
      },
      onTabPin: (tabId, pinned) => {
        const tab = this.tabs.find(t => t.id === tabId);
        if (tab) {
          tab.pinned = pinned;
          this.tabModule?.render();
          this.saveTabState();
        }
      },
      onTabDuplicate: (tabId) => {
        const tab = this.tabs.find(t => t.id === tabId);
        if (tab) {
          const newTab: ChatTab = {
            id: generateId(),
            conversationId: tab.conversationId,
            label: `${tab.label} (copy)`,
          };
          this.tabs.push(newTab);
          this.tabModule?.render();
          this.saveTabState();
        }
      },
      onCloseOtherTabs: async (tabId) => {
        const otherTabs = this.tabs.filter(t => t.id !== tabId && !t.pinned);
        for (const other of otherTabs) {
          await this.closeTab(other.id);
        }
      },
      getTabs: () => this.tabs.map(t => ({
        id: t.id,
        label: t.label,
        conversationId: t.conversationId,
        pinned: t.pinned,
        linkedPath: t.linkedPath,
      })),
      getActiveTabId: () => this.activeTabId,
      getTabCount: () => this.tabs.length,
    });
    this.updateTabBarVisibility();

    // History panel - use module
    const historyContainer = container.createDiv('chat-history-container');
    this.historyModule = createHistoryPanel(historyContainer, deps, {
      onSelect: async (id) => this.loadConversationById(id),
      onDelete: async (id) => this.deleteConversation(id),
      onDeleteBulk: async (ids) => {
        for (const id of ids) {
          await this.plugin.storage.deleteConversation(id);
        }
        this.showTemporaryStatus(`Deleted ${ids.length} conversation${ids.length > 1 ? 's' : ''}`, 'success', 2000);
        // If current conversation was deleted, create new one
        if (ids.includes(this.conversation.id)) {
          this.conversation = this.createNewConversation();
          this.renderConversation();
        }
      },
      onDuplicate: async (id) => this.duplicateConversation(id),
      onRename: async (id, title) => {
        await this.plugin.storage.renameConversation(id, title);
        this.showTemporaryStatus('Conversation renamed', 'success', 1500);
        if (this.conversation.id === id) {
          this.conversation.title = title;
          this.updateTitle();
        }
      },
      onTogglePin: async (id) => {
        const isPinned = await this.plugin.storage.togglePin(id);
        this.showTemporaryStatus(isPinned ? 'Conversation pinned' : 'Conversation unpinned', 'success', 1500);
        if (this.conversation.id === id) {
          this.conversation.pinned = isPinned;
        }
      },
      onManageTags: (id, tags) => this.promptManageTags(id, tags),
      onContinue: async (id) => this.continueConversation(id),
      getConversations: () => this.plugin.storage.listConversations(),
      getAllTags: () => this.plugin.storage.getAllTags(),
      getCurrentId: () => this.conversation.id,
      showStatus: (msg, type) => this.showTemporaryStatus(msg, type, 2000),
    });

    // Search bar - use module
    this.searchContainer = container.createDiv('search-bar-container');
    this.searchBarModule = createSearchBar(this.searchContainer, deps, {
      getMessageIds: () => this.conversation?.messages.map(m => m.id) ?? [],
      getMessageContent: (id) => this.conversation?.messages.find(m => m.id === id)?.content ?? '',
      scrollToMessage: (id) => {
        const el = this.messageElements.get(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
      highlightMessage: (id) => {
        const el = this.messageElements.get(id);
        if (el) el.addClass('search-current');
      },
      clearHighlights: () => {
        for (const el of this.messageElements.values()) {
          el.removeClass('search-match');
          el.removeClass('search-current');
        }
      },
    });

    // Message queue container - use module
    this.queueContainer = container.createDiv('queue-panel-container');
    this.queueModule = createQueuePanel(this.queueContainer, deps, {
      onRemove: (index) => {
        log.debug('Queue item removed', { index });
      },
      onClear: () => {
        log.debug('Queue cleared');
        this.showTemporaryStatus('Queue cleared', 'info', 2000);
      },
    });

    // Messages area
    this.messagesContainer = container.createDiv('chat-messages');
    this.setupScrollTracking();

    // Initialize message renderer module
    this.messageModule = createMessageRenderer(this.messagesContainer, deps, {
      onCopy: (messageId) => {
        const msg = this.conversation.messages.find(m => m.id === messageId);
        if (msg) {
          navigator.clipboard.writeText(msg.content);
          this.showTemporaryStatus('Message copied', 'success', 1500);
        }
      },
      onRegenerate: (messageId) => {
        const msgIndex = this.conversation.messages.findIndex(m => m.id === messageId);
        if (msgIndex > 0) {
          const userMsg = this.conversation.messages[msgIndex - 1];
          if (userMsg.role === 'user') {
            // Remove this assistant message and resend
            this.conversation.messages = this.conversation.messages.slice(0, msgIndex);
            this.renderAllMessages();
            this.inputEl.value = userMsg.content;
            // Don't auto-send, let user confirm
          }
        }
      },
      onEdit: (messageId) => {
        const msg = this.conversation.messages.find(m => m.id === messageId);
        if (msg) {
          this.inputEl.value = msg.content;
          this.inputEl.focus();
        }
      },
      onReact: (messageId, reaction) => {
        this.toggleReaction(messageId, reaction as 'up' | 'down');
      },
      onBookmark: (messageId) => {
        this.toggleBookmark(messageId);
      },
      onResume: (messageId) => {
        const msg = this.conversation.messages.find(m => m.id === messageId);
        if (msg) {
          this.resumeFromMessage(msg);
        }
      },
      scrollToBottom: () => this.scrollToBottom(),
      canResume: (msg) => !!(msg.sdkUuid && this.getBackend().type === 'sdk'),
    });

    // Status indicator
    this.statusEl = container.createDiv('chat-status');
    this.statusEl.style.display = 'none';

    // Input area - use module
    const inputAreaContainer = container.createDiv('chat-input-area');
    this.inputModule = createInputArea(inputAreaContainer, deps, {
      onSend: (content) => this.sendMessage(content),
      onStop: () => this.stopGeneration(),
      onVoiceToggle: () => this.toggleVoiceInput(),
      onImageAdd: (image) => {
        log.info('Image added', { filename: image.filename, mimeType: image.mimeType });
      },
      onImageRemove: (index) => {
        log.debug('Image removed', { index });
      },
      onInputChange: () => {
        this.updateAutocomplete();
      },
      onKeyDown: (e) => this.handleInputKeyDown(e),
      getCommands: () => getCommandList(),
      isVoiceAvailable: () => ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window),
    });

    // Store references for backward compatibility
    this.inputEl = this.inputModule.getInputElement();
    this.inputWrapper = this.inputModule.getWrapper();

    // Initialize status bar module with input area's button container
    if (this.statusBadgesContainer) {
      this.statusModule = createStatusBar(
        {
          badgesContainer: this.statusBadgesContainer,
          tokenContainer: this.inputModule.getButtonContainer(),
        },
        deps,
        {
          onBackendClick: () => {
            // Could open backend settings
          },
          onContextClick: () => {
            // Toggle active note context
            this.plugin.settings.activeNoteContext = !this.plugin.settings.activeNoteContext;
            this.plugin.saveSettings();
            this.refreshStatusBar();
          },
          onAccountClick: () => {
            // Could show account details
          },
          onTokenCounterClick: () => {
            // Could show detailed token breakdown
          },
          getBackendInfo: () => {
            const backend = this.getBackend();
            return {
              type: backend.type,
              label: backend.type.toUpperCase(),
            };
          },
          getActiveNoteInfo: () => {
            const enabled = this.plugin.settings.activeNoteContext;
            const activeFile = this.plugin.app.workspace.getActiveFile();
            if (enabled && activeFile && activeFile.extension === 'md') {
              return {
                path: activeFile.path,
                title: activeFile.basename,
              };
            }
            return null;
          },
          getAccountInfo: () => {
            const backend = this.getBackend();
            if (backend.type !== 'sdk' || !('getAccountInfo' in backend)) {
              return null;
            }
            const sdkBackend = backend as {
              getAccountInfo(): { email?: string; organization?: string; subscriptionType?: string } | null;
            };
            const info = sdkBackend.getAccountInfo();
            if (!info) return null;
            return {
              email: info.email,
              name: info.organization,
              tier: info.subscriptionType,
            };
          },
          getTokenEstimate: () => {
            const tokens = this.estimateTokens();
            const usage = this.conversation?.usage ?? calculateConversationUsage(this.conversation?.messages ?? []);
            return { tokens, cost: usage.totalCost };
          },
        }
      );
      // Update ephemeral badge state
      this.statusModule.updateEphemeral(this.plugin.settings.ephemeralMode);
    }

    // Initialize context loader module
    this.contextModule = createContextLoader(deps, {
      onContextChange: (info) => {
        // Update status bar badge when context changes
        if (info) {
          this.statusModule?.updateContext({
            path: info.path ?? '',
            title: info.name,
          });
        } else {
          this.statusModule?.updateContext(null);
        }
      },
    });

    // Initialize message orchestrator
    this.messageOrchestrator = createMessageOrchestrator(deps, {
      onMessageStart: (msg) => {
        this.renderMessage(msg);
        this.updateTokenCounter();
        if (msg.role === 'user') {
          this.userScrolledUp = false;
        }
        this.scrollToBottom();
      },
      onMessageUpdate: (id, content) => {
        this.updateMessageContent(id, content);
      },
      onMessageComplete: (id) => {
        // Message complete - ensure actions are visible
        const msgEl = this.messageElements.get(id);
        if (msgEl) {
          const actionsDiv = msgEl.querySelector('.message-actions') as HTMLElement;
          if (actionsDiv) {
            actionsDiv.style.display = '';
          }
        }
      },
      onToolCall: (id, tools) => {
        this.updateMessageTools(id, tools);
      },
      onToolResult: () => {
        // Tool result handled by onToolCall updates
      },
      onError: (error) => {
        log.error('Agent error during message processing', error);
      },
      onProcessingChange: (processing) => {
        this.setProcessing(processing);
      },
      onStatusChange: (message, type) => {
        this.setStatus(message, type);
      },
      onSessionInit: (sessionId, tools) => {
        log.info('Session initialized', { sessionId, toolCount: tools.length });
      },
      onSdkUuid: (messageId, uuid) => {
        log.debug('Stored SDK UUID for message', { messageId, uuid });
      },
      onToolSummary: (messageId, summary) => {
        this.updateToolSummary(messageId, summary);
      },
      onFilesPersisted: (filenames) => {
        log.info('Files modified by Claude', { count: filenames.length });
      },
      onTaskNotification: (taskId, status, summary, outputFile, assistantMsgId) => {
        this.handleTaskNotification(taskId, status, summary, outputFile, assistantMsgId);
      },
      onCompactionStatus: (status) => {
        if (status === 'compacting') {
          this.setStatus('Compacting context...', 'info');
        } else {
          this.setStatus('', 'info');
        }
      },
      onCompactionBoundary: (trigger, preTokens) => {
        const tokensK = Math.round(preTokens / 1000);
        new Notice(`Context compacted: was ~${tokensK}K tokens (${trigger})`, 3000);
        if (!this.conversation.metadata) {
          this.conversation.metadata = { backendType: 'sdk' };
        }
        if (!this.conversation.metadata.compactions) {
          this.conversation.metadata.compactions = [];
        }
        this.conversation.metadata.compactions.push({
          timestamp: Date.now(),
          trigger,
          preTokens,
        });
        this.saveConversation();
      },
      getBackend: () => this.getBackend(),
      getConversation: () => this.conversation,
      getContext: async () => this.buildContextInfo(),
      saveConversation: () => this.saveConversation(),
      updateTokenCounter: () => this.updateTokenCounter(),
      refreshStatusBar: () => this.refreshStatusBar(),
      scrollToBottom: () => this.scrollToBottom(),
      getModel: () => this.plugin.settings.model,
    });

    // Mobile support - use module
    this.mobileModule = createMobileSupport(container, deps, {
      onNewConversation: () => this._newConversation(),
      onSwipeLeft: () => {
        if (this.historyModule?.isVisible()) this._toggleHistory();
      },
      onSwipeRight: () => {
        if (!this.historyModule?.isVisible()) this._toggleHistory();
      },
      isMobile: () => this.isMobile(),
    });
    this.mobileModule.setupTouchHandling(container);

    // Slash commands processor - use module
    this.slashCommandsModule = createSlashCommands(deps, {
      getCommandContext: () => this.createCommandContext(),
      renderMessage: (msg) => this.renderMessage(msg),
      scrollToBottom: (force) => this.scrollToBottom(force),
      showTemporaryStatus: (msg, type, duration) => this.showTemporaryStatus(msg, type, duration),
      toggleHistory: () => this._toggleHistory(),
      togglePin: async () => {
        await this.plugin.storage.togglePin(this.conversation.id);
        this.conversation.pinned = !this.conversation.pinned;
        this.showTemporaryStatus(
          this.conversation.pinned ? 'Conversation pinned' : 'Conversation unpinned',
          'success',
          1500
        );
      },
      renameConversation: (title) => {
        if (title) {
          this.plugin.storage.renameConversation(this.conversation.id, title);
          this.conversation.title = title;
          this.updateTitle();
          this.showTemporaryStatus('Conversation renamed', 'success', 1500);
        } else {
          this.promptRenameConversation(this.conversation.id, this.conversation.title);
        }
      },
      showStats: () => this.showConversationStats(),
      showUsageDashboard: () => this.showUsageDashboard(),
      copyToClipboard: () => this.copyConversationToClipboard(),
      handleToolsCommand: (args) => this.handleToolsCommand(args),
      handleContextCommand: (args) => this.handleContextCommand(args),
      handleDuplicateCommand: () => this.handleDuplicateCommand(),
      showBookmarks: () => this.showBookmarks(),
      handlePromptsCommand: (args) => this.handlePromptsCommand(args),
      handleUndoCommand: (args) => this.handleUndoCommand(args),
      handleBudgetCommand: (args) => this.handleBudgetCommand(args),
      showCostSummary: () => this.showCostSummary(),
      generateNote: (args) => this.generateNoteFromConversation(args),
      handleModeCommand: (args) => this.handlePermissionModeCommand(args),
      handleMcpCommand: (args) => this.handleMcpCommand(args),
      handleExtractCommand: (args) => this.handleExtractCommand(args),
      handleAnalyzeCommand: (args) => this.handleAnalyzeNoteCommand(args),
      getSkills: () => this.plugin.skillRegistry.getSkills().map(s => ({
        name: s.name,
        description: s.description,
        triggers: s.triggers,
        alwaysActive: s.alwaysActive,
      })),
      skillsEnabled: () => this.plugin.settings.skills.enabled,
      getSkillsFolderPath: () => this.plugin.settings.skills.folderPath,
    });

    // Register keyboard shortcuts
    this.registerKeyboardShortcuts(container);

    // Listen for active file changes to update context badge
    this.registerEvent(
      this.plugin.app.workspace.on('active-leaf-change', () => {
        this.updateContextBadge();
      })
    );

    // Load saved conversation
    await this.loadConversation();
    this.renderAllMessages();

    // Set up SDK hook callbacks
    this.setupHookCallbacks();

    log.debug('Chat view opened', { conversationId: this.conversation.id });
  }

  /**
   * Set up callbacks for SDK hooks (vault refresh, notifications, etc.).
   */
  private setupHookCallbacks(): void {
    this.plugin.backendFactory?.setHookCallbacks({
      onVaultRefresh: () => {
        log.debug('Hook triggered vault refresh');
        // Obsidian auto-refreshes from filesystem changes - just log for debugging
      },
      onNotification: (title: string, message: string, type: 'info' | 'warning' | 'error') => {
        log.debug('Hook notification', { title, message, type });
        if (type === 'error') {
          new Notice(`${title}: ${message}`, 5000);
        } else {
          new Notice(`${title}: ${message}`, 3000);
        }
      },
      onToolBlocked: (toolName: string, reason: string) => {
        log.warn('Hook blocked tool', { toolName, reason });
        new Notice(`Blocked: ${toolName} - ${reason}`, 3000);
      },
      onAuditLog: (toolName: string, input: unknown, output: unknown) => {
        log.info('Tool audit', {
          tool: toolName,
          inputPreview: JSON.stringify(input).slice(0, 100),
          outputPreview: JSON.stringify(output).slice(0, 100),
        });
      },
      onPermissionRequest: async (context: PermissionRequestContext): Promise<PermissionResponse> => {
        log.info('Permission request', { toolName: context.toolName, toolUseID: context.toolUseID });
        return new Promise<PermissionResponse>((resolve) => {
          // Track if modal was resolved by a button
          let resolved = false;
          const safeResolve = (response: PermissionResponse) => {
            if (!resolved) {
              resolved = true;
              resolve(response);
            }
          };
          const modal = new PermissionModal(this.plugin.app, context, safeResolve);
          modal.open();
        });
      },
    });
  }

  private registerKeyboardShortcuts(container: HTMLElement): void {
    // Use keydown on the container for global shortcuts
    container.addEventListener('keydown', (e) => {
      const isMod = e.ctrlKey || e.metaKey;

      // Ctrl/Cmd+F for search
      if (isMod && e.key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        this._toggleSearch();
        return;
      }

      // Ctrl/Cmd+N for new conversation
      if (isMod && e.key === 'n') {
        e.preventDefault();
        e.stopPropagation();
        this._newConversation();
        return;
      }

      // Ctrl/Cmd+H for history panel
      if (isMod && e.key === 'h') {
        e.preventDefault();
        e.stopPropagation();
        this._toggleHistory();
        return;
      }

      // Ctrl/Cmd+E for export
      if (isMod && e.key === 'e') {
        e.preventDefault();
        e.stopPropagation();
        this.exportConversation();
        return;
      }

      // Ctrl/Cmd+P for pin toggle
      if (isMod && e.shiftKey && e.key === 'p') {
        e.preventDefault();
        e.stopPropagation();
        this.togglePinConversation(this.conversation.id);
        return;
      }

      // Ctrl/Cmd+L to focus input (like terminal)
      if (isMod && e.key === 'l') {
        e.preventDefault();
        e.stopPropagation();
        this.inputEl.focus();
        return;
      }

      // Escape to close search or history
      if (e.key === 'Escape') {
        if (this.searchVisible) {
          this._toggleSearch();
        } else if (this.historyModule?.isVisible()) {
          this._toggleHistory();
        } else {
          // Focus input if nothing else to close
          this.inputEl.focus();
        }
      }
    });

    // Make container focusable for keyboard events
    container.setAttribute('tabindex', '-1');
  }

  private createHeader(header: HTMLElement): void {
    // Left section: History toggle
    const leftSection = header.createDiv('header-left');

    const historyBtn = leftSection.createEl('button', {
      cls: 'chat-action-btn chat-history-btn',
      attr: { 'aria-label': 'Conversation history' },
    });
    setIcon(historyBtn, 'menu');
    historyBtn.onclick = () => this._toggleHistory();

    // Center section: Title + subtle status indicators
    const centerSection = header.createDiv('header-center');

    this.chatTitleEl = centerSection.createDiv('chat-title');
    this.chatTitleEl.setText('Claude Chat');
    this.chatTitleEl.onclick = () => this._toggleHistory();

    // Status indicators container - badges created by statusBar module
    this.statusBadgesContainer = centerSection.createDiv('header-status');

    // Right section: Primary actions
    const rightSection = header.createDiv('header-right');

    // New conversation (primary action, slightly emphasized)
    const newBtn = rightSection.createEl('button', {
      cls: 'chat-action-btn chat-new-btn',
      attr: { 'aria-label': 'New conversation' },
    });
    setIcon(newBtn, 'plus');
    newBtn.onclick = () => this._newConversation();

    // More menu (contains secondary actions)
    const moreBtn = rightSection.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'More options' },
    });
    setIcon(moreBtn, 'more-vertical');
    moreBtn.onclick = (e) => this.showHeaderMenu(e);
  }

  /**
   * Show the header "more" menu with secondary actions
   */
  private showHeaderMenu(e: MouseEvent): void {
    const menu = new Menu();

    menu.addItem((item) => {
      item.setTitle('Search messages')
        .setIcon('search')
        .onClick(() => this._toggleSearch());
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item.setTitle('Export as note')
        .setIcon('file-down')
        .onClick(() => this.exportConversation());
    });

    menu.addItem((item) => {
      item.setTitle('Copy to clipboard')
        .setIcon('clipboard-copy')
        .onClick(() => this.copyToClipboard());
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item.setTitle('Rename conversation')
        .setIcon('pencil')
        .onClick(() => this.promptRenameConversation(this.conversation.id, this.conversation.title));
    });

    menu.addItem((item) => {
      item.setTitle('Clear messages')
        .setIcon('trash-2')
        .onClick(() => this._clearMessages());
    });

    menu.showAtMouseEvent(e);
  }

  private async _toggleHistory(): Promise<void> {
    if (this.historyModule) {
      await this.historyModule.toggle();
    }
  }

  private _toggleSearch(): void {
    if (this.searchBarModule) {
      this.searchBarModule.toggle();
      this.searchVisible = this.searchBarModule.isVisible();
    } else {
      // Fallback for legacy behavior
      this.searchVisible = !this.searchVisible;
      this.searchContainer.style.display = this.searchVisible ? 'flex' : 'none';
    }
  }

  private addToQueue(content: string): void {
    if (!this.queueModule) return;
    this.queueModule.add({ content, timestamp: Date.now() });
    this.showTemporaryStatus(`Message queued (${this.queueModule.getCount()} in queue)`, 'info', 2000);
    log.debug('Message added to queue', { queueLength: this.queueModule.getCount() });
  }

  private removeFromQueue(index: number): void {
    if (!this.queueModule) return;
    this.queueModule.remove(index);
    log.debug('Message removed from queue', { index });
  }

  private clearQueue(): void {
    if (!this.queueModule) return;
    this.queueModule.clear();
    log.debug('Queue cleared');
  }

  private async processNextInQueue(): Promise<void> {
    if (!this.queueModule || this.isProcessing) return;

    const nextMessage = this.queueModule.getNext();
    if (!nextMessage) return;

    log.info('Processing next message from queue');
    this.inputEl.value = nextMessage.content;
    await this.sendMessage();
  }

  private setupScrollTracking(): void {
    // Create scroll-to-bottom button
    this.scrollToBottomBtn = this.messagesContainer.createEl('button', {
      cls: 'scroll-to-bottom-btn',
      attr: { 'aria-label': 'Scroll to bottom' },
    });
    setIcon(this.scrollToBottomBtn, 'arrow-down');
    this.scrollToBottomBtn.onclick = () => this.scrollToBottom(true);

    this.messagesContainer.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = this.messagesContainer;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      // User is "near bottom" if within threshold of the bottom
      this.userScrolledUp = distanceFromBottom > SCROLL_THRESHOLD_PX;

      // Show/hide scroll-to-bottom button
      if (this.scrollToBottomBtn) {
        this.scrollToBottomBtn.toggleClass('visible', this.userScrolledUp);
      }
    });
  }

  private async promptRenameConversation(id: string, currentTitle: string): Promise<void> {
    // Create a simple modal for renaming using safe DOM methods
    const modal = document.createElement('div');
    modal.className = 'obsidi-claude-rename-modal';

    const backdrop = document.createElement('div');
    backdrop.className = 'rename-modal-backdrop';
    modal.appendChild(backdrop);

    const content = document.createElement('div');
    content.className = 'rename-modal-content';

    const heading = document.createElement('h3');
    heading.textContent = 'Rename Conversation';
    content.appendChild(heading);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = currentTitle;
    content.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'rename-modal-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'mod-cta rename-save';
    saveBtn.textContent = 'Save';
    actions.appendChild(saveBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'rename-cancel';
    cancelBtn.textContent = 'Cancel';
    actions.appendChild(cancelBtn);

    content.appendChild(actions);
    modal.appendChild(content);
    document.body.appendChild(modal);

    const closeModal = () => modal.remove();

    const saveRename = async () => {
      const newTitle = input.value.trim();
      if (newTitle && newTitle !== currentTitle) {
        await this.plugin.storage.renameConversation(id, newTitle);
        this.showTemporaryStatus('Conversation renamed', 'success', 1500);
        await this.historyModule?.refresh();

        // Update current conversation title if it's the one being renamed
        if (this.conversation.id === id) {
          this.conversation.title = newTitle;
          this.updateTitle();
        }
      }
      closeModal();
    };

    input.focus();
    input.select();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveRename();
      if (e.key === 'Escape') closeModal();
    });

    saveBtn.onclick = saveRename;
    cancelBtn.onclick = closeModal;
    backdrop.onclick = closeModal;
  }

  private async promptManageTags(id: string, currentTags: string[]): Promise<void> {
    // Create tag management modal
    const modal = document.createElement('div');
    modal.className = 'obsidi-claude-rename-modal'; // Reuse modal styles

    const backdrop = document.createElement('div');
    backdrop.className = 'rename-modal-backdrop';
    modal.appendChild(backdrop);

    const content = document.createElement('div');
    content.className = 'rename-modal-content';

    const heading = document.createElement('h3');
    heading.textContent = 'Manage Tags';
    content.appendChild(heading);

    // Current tags display
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'tag-manager-tags';
    content.appendChild(tagsContainer);

    const renderTags = (tags: string[]) => {
      tagsContainer.innerHTML = '';
      if (tags.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'tag-manager-empty';
        empty.textContent = 'No tags yet';
        tagsContainer.appendChild(empty);
      } else {
        for (const tag of tags) {
          const tagEl = document.createElement('span');
          tagEl.className = 'tag-manager-tag';
          tagEl.textContent = tag;

          const removeBtn = document.createElement('span');
          removeBtn.className = 'tag-remove-btn';
          removeBtn.textContent = '×';
          removeBtn.onclick = async () => {
            const idx = tags.indexOf(tag);
            if (idx >= 0) {
              tags.splice(idx, 1);
              await this.plugin.storage.updateTags(id, tags);
              renderTags(tags);
            }
          };
          tagEl.appendChild(removeBtn);
          tagsContainer.appendChild(tagEl);
        }
      }
    };

    renderTags([...currentTags]);

    // Add tag input
    const inputRow = document.createElement('div');
    inputRow.className = 'tag-manager-input-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.placeholder = 'Add a tag...';
    inputRow.appendChild(input);

    const addBtn = document.createElement('button');
    addBtn.className = 'mod-cta';
    addBtn.textContent = 'Add';
    inputRow.appendChild(addBtn);

    content.appendChild(inputRow);

    // All existing tags (for suggestions)
    const allTags = await this.plugin.storage.getAllTags();
    const unusedTags = allTags.filter(t => !currentTags.includes(t));

    if (unusedTags.length > 0) {
      const suggestionsLabel = document.createElement('div');
      suggestionsLabel.className = 'tag-suggestions-label';
      suggestionsLabel.textContent = 'Existing tags:';
      content.appendChild(suggestionsLabel);

      const suggestions = document.createElement('div');
      suggestions.className = 'tag-suggestions';
      for (const tag of unusedTags) {
        const suggBtn = document.createElement('span');
        suggBtn.className = 'tag-suggestion';
        suggBtn.textContent = tag;
        suggBtn.onclick = async () => {
          if (!currentTags.includes(tag)) {
            currentTags.push(tag);
            await this.plugin.storage.updateTags(id, currentTags);
            renderTags(currentTags);
            // Remove from suggestions
            suggBtn.remove();
          }
        };
        suggestions.appendChild(suggBtn);
      }
      content.appendChild(suggestions);
    }

    // Close button
    const actions = document.createElement('div');
    actions.className = 'rename-modal-actions';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'rename-cancel';
    closeBtn.textContent = 'Done';
    actions.appendChild(closeBtn);

    content.appendChild(actions);
    modal.appendChild(content);
    document.body.appendChild(modal);

    const closeModal = async () => {
      modal.remove();
      await this.historyModule?.refresh();
      // Update current conversation if modified
      if (this.conversation.id === id) {
        this.conversation.tags = currentTags;
      }
    };

    const addTag = async () => {
      const newTag = input.value.trim().toLowerCase();
      if (newTag && !currentTags.includes(newTag)) {
        currentTags.push(newTag);
        await this.plugin.storage.updateTags(id, currentTags);
        renderTags(currentTags);
        input.value = '';
      }
    };

    input.focus();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addTag();
      if (e.key === 'Escape') closeModal();
    });

    addBtn.onclick = addTag;
    closeBtn.onclick = closeModal;
    backdrop.onclick = closeModal;
  }

  private async loadConversationById(id: string): Promise<void> {
    const conv = await this.plugin.storage.loadConversation(id);
    if (conv) {
      this.conversation = conv;
      this.lastSentNotePath = null; // Reset note tracking when switching conversations
      this.lastSentNoteContent = null;
      await this.plugin.storage.setCurrentConversationId(id);
      this.renderAllMessages();
      this.updateTitle();
      this._toggleHistory();
    }
  }

  private async continueConversation(id: string): Promise<void> {
    await this.loadConversationById(id);

    if (this.conversation.sessionId) {
      this.showTemporaryStatus('Session restored - ready to continue', 'success');
    } else {
      this.showTemporaryStatus('No session to resume - starting fresh', 'info');
    }

    // Focus input
    this.inputEl.focus();
  }

  private async duplicateConversation(id: string): Promise<void> {
    const newConv = await this.plugin.storage.duplicateConversation(id);
    if (newConv) {
      this.showTemporaryStatus('Conversation duplicated', 'success', 1500);
      await this.historyModule?.refresh();
    } else {
      this.showTemporaryStatus('Failed to duplicate conversation', 'error', 2000);
    }
  }

  private async deleteConversation(id: string): Promise<void> {
    // Don't delete if it's the only one and currently active
    const conversations = await this.plugin.storage.listConversations();
    const isCurrentConv = id === this.conversation.id;

    await this.plugin.storage.deleteConversation(id);

    if (isCurrentConv) {
      // Load another conversation or create new
      const remaining = conversations.filter((c) => c.id !== id);
      if (remaining.length > 0) {
        await this.loadConversationById(remaining[0].id);
      } else {
        await this._newConversation();
      }
    }

    await this.historyModule?.refresh();
  }

  private updateTitle(): void {
    if (!this.chatTitleEl) return;
    const title = this.conversation.title || 'New Conversation';
    this.chatTitleEl.setText(title.length > 30 ? title.slice(0, 30) + '...' : title);
    // Also update the active tab label
    this.updateActiveTabLabel();
  }

  /**
   * Handle keydown events from input area for autocomplete navigation.
   * Returns true if event was handled.
   */
  private handleInputKeyDown(e: KeyboardEvent): boolean {
    // Handle autocomplete navigation
    if (this.autocompleteEl && this.autocompleteCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.autocompleteIndex = Math.min(this.autocompleteIndex + 1, this.autocompleteCommands.length - 1);
        this.updateAutocompleteSelection();
        return true;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.autocompleteIndex = Math.max(this.autocompleteIndex - 1, 0);
        this.updateAutocompleteSelection();
        return true;
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        this.selectAutocompleteCommand();
        return true;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.hideAutocomplete();
        return true;
      }
    }

    // Escape without autocomplete - still hide it
    if (e.key === 'Escape') {
      this.hideAutocomplete();
    }

    return false; // Let module handle it
  }

  private createNewConversation(): Conversation {
    // Get current backend type for metadata
    const backend = this.plugin.backendFactory?.getBackend();
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

  private async loadConversation(): Promise<void> {
    try {
      this.conversation = await this.plugin.storage.getCurrentConversation();
      this.updateTitle();
      log.debug('Conversation loaded', {
        id: this.conversation.id,
        messageCount: this.conversation.messages.length,
      });
    } catch (error) {
      log.error('Failed to load conversation', error);
    }
  }

  private async saveConversation(): Promise<void> {
    // Update session ID from current backend
    const backend = this.getBackend();
    const sessionId = backend.getSessionId();
    if (sessionId) {
      this.conversation.sessionId = sessionId;
      if (!this.conversation.metadata) {
        this.conversation.metadata = { backendType: backend.type };
      }
      this.conversation.metadata.sessionId = sessionId;
    }

    // Auto-generate title after first exchange if still default
    if (
      this.conversation.title === 'New Conversation' &&
      this.conversation.messages.length >= 2
    ) {
      const firstUserMsg = this.conversation.messages.find((m) => m.role === 'user');
      const firstAssistantMsg = this.conversation.messages.find((m) => m.role === 'assistant');

      if (firstUserMsg && firstAssistantMsg) {
        // Try smart title generation in background
        this.generateSmartTitle(firstUserMsg.content, firstAssistantMsg.content);
      } else if (firstUserMsg) {
        // Fallback to simple truncation
        this.conversation.title = this.plugin.storage.generateTitle(firstUserMsg.content);
        this.updateTitle();
      }
    }

    await this.plugin.storage.saveConversation(this.conversation);
  }

  private renderAllMessages(): void {
    if (!this.messagesContainer) return;

    // Use module if available
    if (this.messageModule) {
      this.messageModule.clear();
      this.messageElements.clear();

      // Show welcome state if no messages
      if (this.conversation.messages.length === 0) {
        this.showWelcomeState();
      } else {
        for (const msg of this.conversation.messages) {
          const el = this.messageModule.renderMessage(msg);
          this.messageElements.set(msg.id, el);
        }
      }
    } else {
      // Fallback: legacy inline rendering
      this.messagesContainer.empty();
      this.messageElements.clear();

      if (this.conversation.messages.length === 0) {
        this.showWelcomeState();
      } else {
        for (const msg of this.conversation.messages) {
          this.renderMessage(msg);
        }
      }
    }
    // Force scroll when rendering all messages (loading conversation)
    this.userScrolledUp = false;
    this.scrollToBottom(true);

    // Update token counter
    this.updateTokenCounter();
  }

  /**
   * Show welcome state when conversation is empty.
   */
  private showWelcomeState(): void {
    if (!this.messagesContainer) return;

    if (this.mobileModule?.isMobile()) {
      this.mobileModule.showSwipeHint(this.messagesContainer);
    } else {
      // Desktop welcome state
      const welcomeContainer = this.messagesContainer.createDiv('desktop-welcome');
      welcomeContainer.style.cssText = 'display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 2rem; text-align: center; color: var(--text-muted);';

      const title = welcomeContainer.createEl('h3', { text: 'Chat with Claude' });
      title.style.cssText = 'margin: 0 0 0.5rem 0; color: var(--text-normal);';

      const subtitle = welcomeContainer.createDiv();
      subtitle.style.cssText = 'margin-bottom: 1rem; font-size: 0.9rem;';
      subtitle.setText('Ask questions, get help with your notes, and explore your vault.');

      const hint = welcomeContainer.createDiv();
      hint.style.cssText = 'font-size: 0.85rem; opacity: 0.7;';
      hint.setText('Type a message below or use /help for commands');
    }
  }

  private renderMessage(msg: ChatMessage): HTMLElement | null {
    if (!this.messagesContainer) return null;

    // Use module if available
    if (this.messageModule) {
      const el = this.messageModule.renderMessage(msg);
      this.messageElements.set(msg.id, el);
      return el;
    }

    // Fallback: legacy inline rendering
    const msgDiv = this.messagesContainer.createDiv('chat-message');
    msgDiv.addClass(msg.role === 'user' ? 'user-message' : 'assistant-message');
    if (msg.bookmarked) {
      msgDiv.addClass('message-bookmarked');
    }
    msgDiv.dataset.messageId = msg.id;

    // Message header (role + time) - outside the bubble
    const headerDiv = msgDiv.createDiv('message-header');
    const roleLabel = headerDiv.createSpan('message-role');
    roleLabel.setText(msg.role === 'user' ? 'You' : 'Claude');
    const timeEl = headerDiv.createSpan('message-time');
    timeEl.setText(new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

    // Message bubble
    const bubbleDiv = msgDiv.createDiv('message-bubble');

    // Tool calls FIRST (shown above content, like Claude Code)
    if (msg.toolCalls && msg.toolCalls.length > 0 && this.plugin.settings.showToolCalls) {
      const toolsDiv = bubbleDiv.createDiv('message-tools');
      for (const tool of msg.toolCalls) {
        this.renderToolCall(toolsDiv, tool);
      }
    }

    // Content inside bubble (after tools)
    const contentDiv = bubbleDiv.createDiv('message-content');

    // Render images if present
    if (msg.images && msg.images.length > 0) {
      const imagesDiv = contentDiv.createDiv('message-images');
      for (const img of msg.images) {
        const imgEl = imagesDiv.createEl('img', {
          cls: 'message-image',
          attr: {
            src: `data:${img.mimeType};base64,${img.data}`,
            alt: img.filename || 'Attached image',
          },
        });
        // Click to open larger view
        imgEl.onclick = () => {
          window.open(`data:${img.mimeType};base64,${img.data}`, '_blank');
        };
      }
    }

    if (msg.content) {
      MarkdownRenderer.render(
        this.plugin.app,
        msg.content,
        contentDiv,
        '',
        new Component()
      );
      // Add copy buttons to code blocks
      this.addCodeBlockCopyButtons(contentDiv);
    } else if (msg.isStreaming) {
      contentDiv.createDiv('typing-indicator');
    }

    // Message action buttons (optional, hidden during streaming)
    if (this.plugin.settings.showMessageActions) {
      const actionsDiv = msgDiv.createDiv('message-actions');
      if (msg.isStreaming) {
        actionsDiv.style.display = 'none';
      }
      this.createMessageActions(actionsDiv, msg);
    }

    this.messageElements.set(msg.id, msgDiv);
    return msgDiv;
  }

  private createMessageActions(container: HTMLElement, msg: ChatMessage): void {
    // Bookmark button
    const bookmarkBtn = container.createEl('button', {
      cls: `message-action-btn bookmark-btn ${msg.bookmarked ? 'bookmark-active' : ''}`,
      attr: { 'aria-label': msg.bookmarked ? 'Remove bookmark' : 'Bookmark message' }
    });
    setIcon(bookmarkBtn, msg.bookmarked ? 'bookmark-check' : 'bookmark');
    bookmarkBtn.onclick = (e) => {
      e.stopPropagation();
      this.toggleBookmark(msg.id);
    };

    // Copy button
    const copyBtn = container.createEl('button', {
      cls: 'message-action-btn',
      attr: { 'aria-label': 'Copy message' }
    });
    setIcon(copyBtn, 'copy');
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(msg.content);
      // Show feedback
      setIcon(copyBtn, 'check');
      setTimeout(() => setIcon(copyBtn, 'copy'), 1500);
    };

    // Only show regenerate and reactions for assistant messages
    if (msg.role === 'assistant') {
      // Thumbs up reaction
      const thumbsUpBtn = container.createEl('button', {
        cls: `message-action-btn reaction-btn ${msg.reaction === 'up' ? 'reaction-active' : ''}`,
        attr: { 'aria-label': 'Good response' }
      });
      setIcon(thumbsUpBtn, 'thumbs-up');
      thumbsUpBtn.onclick = (e) => {
        e.stopPropagation();
        this.toggleReaction(msg.id, 'up');
      };

      // Thumbs down reaction
      const thumbsDownBtn = container.createEl('button', {
        cls: `message-action-btn reaction-btn ${msg.reaction === 'down' ? 'reaction-active' : ''}`,
        attr: { 'aria-label': 'Poor response' }
      });
      setIcon(thumbsDownBtn, 'thumbs-down');
      thumbsDownBtn.onclick = (e) => {
        e.stopPropagation();
        this.toggleReaction(msg.id, 'down');
      };

      // Regenerate button
      const regenBtn = container.createEl('button', {
        cls: 'message-action-btn',
        attr: { 'aria-label': 'Regenerate response' }
      });
      setIcon(regenBtn, 'refresh-cw');
      regenBtn.onclick = (e) => {
        e.stopPropagation();
        // Find the user message before this one and resend
        const msgIndex = this.conversation.messages.findIndex(m => m.id === msg.id);
        if (msgIndex > 0) {
          const userMsg = this.conversation.messages[msgIndex - 1];
          if (userMsg.role === 'user') {
            // Remove this assistant message and resend
            this.conversation.messages = this.conversation.messages.slice(0, msgIndex);
            this.renderAllMessages();
            this.inputEl.value = userMsg.content;
            // Don't auto-send, let user confirm
          }
        }
      };

      // Resume from here button (SDK only, requires UUID)
      if (msg.sdkUuid && this.getBackend().type === 'sdk') {
        const resumeBtn = container.createEl('button', {
          cls: 'message-action-btn',
          attr: { 'aria-label': 'Resume from this point' }
        });
        setIcon(resumeBtn, 'corner-up-left');
        resumeBtn.onclick = (e) => {
          e.stopPropagation();
          this.resumeFromMessage(msg);
        };
      }
    }
  }

  private async resumeFromMessage(msg: ChatMessage): Promise<void> {
    if (!msg.sdkUuid) {
      this.showTemporaryStatus('Cannot resume: message has no SDK UUID', 'error', 3000);
      return;
    }

    const sessionId = this.conversation.metadata?.sessionId;
    if (!sessionId) {
      this.showTemporaryStatus('Cannot resume: no session ID', 'error', 3000);
      return;
    }

    // Create a new conversation forked from this point
    const newConv = await this.plugin.storage.duplicateConversation(this.conversation.id);
    if (!newConv) {
      this.showTemporaryStatus('Failed to create forked conversation', 'error', 3000);
      return;
    }

    // Trim messages to only include up to the selected message
    const msgIndex = this.conversation.messages.findIndex(m => m.id === msg.id);
    if (msgIndex >= 0) {
      newConv.messages = this.conversation.messages.slice(0, msgIndex + 1);
    }

    // Set up the fork metadata
    if (!newConv.metadata) {
      newConv.metadata = { backendType: 'sdk' };
    }
    newConv.metadata.resumeAtUuid = msg.sdkUuid;
    newConv.metadata.forkFromSessionId = sessionId;
    newConv.title = `${this.conversation.title} (from checkpoint)`;

    await this.plugin.storage.saveConversation(newConv);
    this.conversation = newConv;
    await this.plugin.storage.setCurrentConversationId(newConv.id);
    this.renderAllMessages();
    this.updateTitle();
    this.showTemporaryStatus('Resumed from checkpoint - continue the conversation', 'success', 3000);
  }

  private async toggleBookmark(messageId: string): Promise<void> {
    const msg = this.conversation.messages.find(m => m.id === messageId);
    if (!msg) return;

    msg.bookmarked = !msg.bookmarked;

    // Use module if available
    if (this.messageModule) {
      this.messageModule.updateBookmarkState(messageId, msg.bookmarked);
      this.messageModule.updateActions(messageId, msg);
    } else {
      // Fallback: legacy inline update
      const msgEl = this.messageElements.get(messageId);
      if (msgEl) {
        msgEl.toggleClass('message-bookmarked', msg.bookmarked);
        const actionsDiv = msgEl.querySelector('.message-actions') as HTMLElement;
        if (actionsDiv) {
          actionsDiv.empty();
          this.createMessageActions(actionsDiv, msg);
        }
      }
    }

    await this.saveConversation();
  }

  private async toggleReaction(messageId: string, reaction: 'up' | 'down'): Promise<void> {
    const msg = this.conversation.messages.find(m => m.id === messageId);
    if (!msg) return;

    // Toggle: if same reaction, clear it; otherwise set new reaction
    msg.reaction = msg.reaction === reaction ? null : reaction;

    // Use module if available
    if (this.messageModule) {
      this.messageModule.updateActions(messageId, msg);
    } else {
      // Fallback: legacy inline update
      const msgEl = this.messageElements.get(messageId);
      if (msgEl) {
        const actionsDiv = msgEl.querySelector('.message-actions') as HTMLElement;
        if (actionsDiv) {
          actionsDiv.empty();
          this.createMessageActions(actionsDiv, msg);
        }
      }
    }

    // Save the conversation
    await this.saveConversation();
  }

  private async addTagToConversation(tag: string): Promise<void> {
    const tags = this.conversation.tags || [];
    if (!tags.includes(tag)) {
      tags.push(tag);
      this.conversation.tags = tags;
      await this.plugin.storage.updateTags(this.conversation.id, tags);
      this.showTemporaryStatus(`Tag "${tag}" added`, 'success', 1500);
    } else {
      this.showTemporaryStatus(`Tag "${tag}" already exists`, 'info', 1500);
    }
  }

  private async removeTagFromConversation(tag: string): Promise<void> {
    const tags = this.conversation.tags || [];
    const index = tags.indexOf(tag);
    if (index >= 0) {
      tags.splice(index, 1);
      this.conversation.tags = tags;
      await this.plugin.storage.updateTags(this.conversation.id, tags);
      this.showTemporaryStatus(`Tag "${tag}" removed`, 'success', 1500);
    } else {
      this.showTemporaryStatus(`Tag "${tag}" not found`, 'info', 1500);
    }
  }

  private renderToolCall(container: HTMLElement, tool: ToolCallInfo): void {
    const toolDiv = container.createDiv('tool-call');
    toolDiv.addClass(`tool-status-${tool.status}`);

    // Tool header row with icon and name (clickable to expand)
    const headerDiv = toolDiv.createDiv('tool-call-header');
    headerDiv.setAttribute('aria-label', 'Click to expand details');

    const iconEl = headerDiv.createSpan('tool-icon');
    setIcon(iconEl, TOOL_STATUS_ICONS[tool.status]);

    const nameEl = headerDiv.createSpan('tool-name');
    nameEl.setText(tool.name);

    // Brief summary on the right
    const summaryEl = headerDiv.createSpan('tool-summary');
    summaryEl.setText(this.getToolSummary(tool));

    // Chevron for expand/collapse
    const chevronEl = headerDiv.createSpan('tool-chevron');
    setIcon(chevronEl, 'chevron-right');

    // Expandable details section (hidden by default)
    const detailsDiv = toolDiv.createDiv('tool-details');
    detailsDiv.style.display = 'none';

    // Input section
    if (tool.input && Object.keys(tool.input).length > 0) {
      const inputSection = detailsDiv.createDiv('tool-detail-section');
      inputSection.createEl('div', { text: 'Input', cls: 'tool-detail-label' });
      const inputContent = inputSection.createDiv('tool-detail-content');
      inputContent.createEl('pre').setText(JSON.stringify(tool.input, null, 2));
    }

    // Result section
    if (tool.result) {
      const resultSection = detailsDiv.createDiv('tool-detail-section');
      resultSection.createEl('div', {
        text: tool.status === 'error' ? 'Error' : 'Result',
        cls: 'tool-detail-label'
      });
      const resultContent = resultSection.createDiv('tool-detail-content');
      resultContent.createEl('pre').setText(tool.result);
    }

    // Toggle expansion on header click
    headerDiv.onclick = (e) => {
      e.stopPropagation();
      const isExpanded = detailsDiv.style.display !== 'none';
      detailsDiv.style.display = isExpanded ? 'none' : 'block';
      toolDiv.toggleClass('tool-expanded', !isExpanded);
      setIcon(chevronEl, isExpanded ? 'chevron-right' : 'chevron-down');
    };
  }

  private getToolSummary(tool: ToolCallInfo): string {
    // Generate a brief summary based on tool type and input
    const input = tool.input as Record<string, unknown>;

    switch (tool.name) {
      case 'semantic_search':
      case 'search_content':
        return input.query ? `"${String(input.query).slice(0, 30)}..."` : '';
      case 'create_note':
      case 'append_to_note':
      case 'rename_note':
      case 'open_note':
        return input.path ? String(input.path).split('/').pop() || '' : '';
      case 'vault_structure':
        return input.path ? String(input.path) : 'root';
      case 'file_metadata':
      case 'backlinks':
      case 'outgoing_links':
        return input.path ? String(input.path).split('/').pop() || '' : '';
      default:
        // For other tools, show first string value
        for (const val of Object.values(input)) {
          if (typeof val === 'string' && val.length > 0) {
            return val.length > 30 ? val.slice(0, 30) + '...' : val;
          }
        }
        return '';
    }
  }

  private updateToolSummary(messageId: string, summary: string): void {
    const msgEl = this.messageElements.get(messageId);
    if (!msgEl) return;

    // Find or create the summary container
    let summaryEl = msgEl.querySelector('.tool-summary-banner') as HTMLElement;
    if (!summaryEl) {
      const toolsContainer = msgEl.querySelector('.message-tools');
      if (toolsContainer) {
        summaryEl = toolsContainer.createDiv('tool-summary-banner');
        // Insert at the beginning of tools container
        toolsContainer.insertBefore(summaryEl, toolsContainer.firstChild);
      } else {
        // Create tools container if it doesn't exist
        const contentDiv = msgEl.querySelector('.message-content');
        if (contentDiv) {
          const toolsDiv = contentDiv.createDiv('message-tools');
          summaryEl = toolsDiv.createDiv('tool-summary-banner');
        }
      }
    }

    if (summaryEl) {
      summaryEl.empty();
      const icon = summaryEl.createSpan('tool-summary-icon');
      setIcon(icon, 'sparkles');
      summaryEl.createSpan('tool-summary-text').setText(summary);
    }
  }

  /**
   * Handle background task (subagent) notification from SDK.
   */
  private handleTaskNotification(
    taskId: string,
    status: 'completed' | 'failed' | 'stopped',
    summary: string,
    outputFile: string,
    assistantMsgId: string | null
  ): void {
    const statusIcons: Record<string, string> = {
      completed: '✅',
      failed: '❌',
      stopped: '⏹️',
    };

    const statusIcon = statusIcons[status] || '📋';
    const shortTaskId = taskId.slice(0, 8);

    // Show notification
    const noticeText = `${statusIcon} Task ${shortTaskId}: ${summary.slice(0, 50)}${summary.length > 50 ? '...' : ''}`;
    new Notice(noticeText, status === 'failed' ? 5000 : 3000);

    // If we have an assistant message, add a task notification banner
    if (assistantMsgId) {
      const msgEl = this.messageElements.get(assistantMsgId);
      if (msgEl) {
        const toolsContainer = msgEl.querySelector('.message-tools') || msgEl.querySelector('.message-content')?.createDiv('message-tools');
        if (toolsContainer) {
          const notifEl = (toolsContainer as HTMLElement).createDiv('task-notification-banner');
          notifEl.addClass(`task-status-${status}`);

          const icon = notifEl.createSpan('task-notification-icon');
          icon.setText(statusIcon);

          const textEl = notifEl.createSpan('task-notification-text');
          textEl.setText(`Task ${shortTaskId}: ${summary}`);

          // Add link to output file if available
          if (outputFile && status === 'completed') {
            const linkEl = notifEl.createEl('a', { cls: 'task-output-link', text: ' (view output)' });
            linkEl.addEventListener('click', () => {
              // Try to open the output file
              log.debug('Opening task output', { outputFile });
              // Since this is an external file path, show it in a notice
              new Notice(`Output file: ${outputFile}`, 5000);
            });
          }
        }
      }
    }

    log.info('Task notification displayed', { taskId: shortTaskId, status, summary });
  }

  private updateMessageContent(messageId: string, content: string): void {
    // Use module if available
    if (this.messageModule) {
      this.messageModule.updateContent(messageId, content);
      return;
    }

    // Fallback: legacy inline update
    const msgEl = this.messageElements.get(messageId);
    if (!msgEl) return;

    const contentDiv = msgEl.querySelector('.message-content');
    if (!contentDiv) return;

    contentDiv.empty();

    if (content) {
      MarkdownRenderer.render(
        this.plugin.app,
        content,
        contentDiv as HTMLElement,
        '',
        new Component()
      );
      // Add copy buttons to code blocks
      this.addCodeBlockCopyButtons(contentDiv as HTMLElement);
    }

    // Show message actions (hidden during streaming)
    const actionsDiv = msgEl.querySelector('.message-actions') as HTMLElement;
    if (actionsDiv) {
      actionsDiv.style.display = '';
    }

    this.scrollToBottom();
  }

  private addCodeBlockCopyButtons(container: HTMLElement): void {
    const codeBlocks = container.querySelectorAll('pre > code');
    codeBlocks.forEach((codeEl) => {
      const pre = codeEl.parentElement;
      if (!pre || pre.querySelector('.code-copy-btn')) return; // Already has button

      // Make pre position relative for absolute button positioning
      pre.style.position = 'relative';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'code-copy-btn';
      copyBtn.setAttribute('aria-label', 'Copy code');
      setIcon(copyBtn, 'copy');

      copyBtn.onclick = (e) => {
        e.stopPropagation();
        const code = codeEl.textContent || '';
        navigator.clipboard.writeText(code);
        setIcon(copyBtn, 'check');
        setTimeout(() => setIcon(copyBtn, 'copy'), 1500);
      };

      pre.appendChild(copyBtn);
    });
  }

  private updateMessageTools(messageId: string, toolCalls: ToolCallInfo[]): void {
    // Use module if available
    if (this.messageModule) {
      this.messageModule.updateTools(messageId, toolCalls);
      return;
    }

    // Fallback: legacy inline update
    const msgEl = this.messageElements.get(messageId);
    if (!msgEl) return;

    const bubbleDiv = msgEl.querySelector('.message-bubble') as HTMLElement;
    if (!bubbleDiv) return;

    let toolsDiv = bubbleDiv.querySelector('.message-tools') as HTMLElement;
    if (!toolsDiv) {
      // Insert tools BEFORE content div
      const contentDiv = bubbleDiv.querySelector('.message-content');
      toolsDiv = document.createElement('div');
      toolsDiv.className = 'message-tools';
      if (contentDiv) {
        bubbleDiv.insertBefore(toolsDiv, contentDiv);
      } else {
        bubbleDiv.appendChild(toolsDiv);
      }
    }

    toolsDiv.empty();
    for (const tool of toolCalls) {
      this.renderToolCall(toolsDiv, tool);
    }
  }

  private setStatus(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
    if (!this.statusEl) return;
    this.statusEl.setText(message);
    this.statusEl.className = `chat-status status-${type}`;
    this.statusEl.style.display = message ? 'block' : 'none';
  }

  private showTemporaryStatus(message: string, type: 'info' | 'error' | 'success' = 'info', durationMs = 3000): void {
    this.setStatus(message, type);
    setTimeout(() => this.setStatus(''), durationMs);
  }

  /**
   * Show usage dashboard with aggregated stats across all conversations
   */
  private async showUsageDashboard(): Promise<void> {
    const conversations = await this.plugin.storage.listConversations();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    let conversationsWithUsage = 0;

    // Calculate totals from all conversations
    const conversationStats: Array<{
      title: string;
      inputTokens: number;
      outputTokens: number;
      cost: number;
    }> = [];

    for (const meta of conversations.slice(0, 20)) { // Limit to recent 20
      const conv = await this.plugin.storage.loadConversation(meta.id);
      if (conv) {
        const usage = conv.usage ?? calculateConversationUsage(conv.messages);
        if (usage.totalCost > 0) {
          conversationsWithUsage++;
          totalInputTokens += usage.totalInputTokens;
          totalOutputTokens += usage.totalOutputTokens;
          totalCost += usage.totalCost;
          conversationStats.push({
            title: conv.title.slice(0, 30),
            inputTokens: usage.totalInputTokens,
            outputTokens: usage.totalOutputTokens,
            cost: usage.totalCost,
          });
        }
      }
    }

    // Build dashboard message
    const lines: string[] = ['# Usage Dashboard'];
    lines.push('');
    lines.push('## Summary');
    lines.push(`- Total input tokens: ${totalInputTokens.toLocaleString()}`);
    lines.push(`- Total output tokens: ${totalOutputTokens.toLocaleString()}`);
    lines.push(`- **Total cost: $${totalCost.toFixed(4)}**`);
    lines.push(`- Conversations tracked: ${conversationsWithUsage}`);
    lines.push('');

    if (conversationStats.length > 0) {
      lines.push('## Top Conversations by Cost');
      lines.push('');
      const sorted = conversationStats.sort((a, b) => b.cost - a.cost).slice(0, 5);
      for (const stat of sorted) {
        lines.push(`- **${stat.title}**: $${stat.cost.toFixed(4)} (${stat.inputTokens.toLocaleString()} in / ${stat.outputTokens.toLocaleString()} out)`);
      }
    } else {
      lines.push('*No usage data tracked yet. Usage data is captured from API responses.*');
    }

    const dashboardMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: lines.join('\n'),
      timestamp: Date.now(),
    };
    this.renderMessage(dashboardMsg);
    this.scrollToBottom(true);
  }

  /**
   * Estimate token count for the conversation.
   * Uses a rough approximation of ~4 characters per token.
   */
  private estimateTokens(): number {
    let totalChars = 0;

    // Count message content
    for (const msg of this.conversation.messages) {
      totalChars += msg.content.length;
      // Add overhead for role and structure
      totalChars += 20;
    }

    // System prompt
    totalChars += this.plugin.settings.systemPrompt.length;

    // Rough estimate based on average chars per token
    return Math.ceil(totalChars / CHARS_PER_TOKEN_ESTIMATE);
  }

  /**
   * Refresh the status bar via the module.
   * Triggers refresh of all status elements: backend, context, account, tokens.
   */
  private refreshStatusBar(): void {
    this.statusModule?.refresh();
  }

  /**
   * Update context badge display.
   * Convenience wrapper for active file change events.
   */
  private updateContextBadge(): void {
    const activeFile = this.plugin.app.workspace.getActiveFile();
    const enabled = this.plugin.settings.activeNoteContext;
    if (enabled && activeFile && activeFile.extension === 'md') {
      this.statusModule?.updateContext({
        path: activeFile.path,
        title: activeFile.basename,
      });
    } else {
      this.statusModule?.updateContext(null);
    }
  }

  /**
   * Update token counter display.
   * Convenience wrapper for message/usage changes.
   */
  private updateTokenCounter(): void {
    const tokens = this.estimateTokens();
    const usage = this.conversation?.usage ?? calculateConversationUsage(this.conversation?.messages ?? []);
    this.statusModule?.updateTokens({ tokens, cost: usage.totalCost });
  }

  /**
   * Generate a smart title using Claude (Haiku) in the background.
   * Falls back to simple truncation if generation fails.
   */
  private async generateSmartTitle(userMessage: string, assistantMessage: string): Promise<void> {
    const backend = this.plugin.backendFactory?.getBackend();

    // Try smart generation if backend supports it
    if (backend?.generateTitle) {
      try {
        const smartTitle = await backend.generateTitle(userMessage, assistantMessage);
        if (smartTitle && this.conversation.title === 'New Conversation') {
          this.conversation.title = smartTitle;
          this.updateTitle();
          await this.plugin.storage.saveConversation(this.conversation);
          log.debug('Generated smart title', { title: smartTitle });
          return;
        }
      } catch (error) {
        log.debug('Smart title generation failed, using fallback', error);
      }
    }

    // Fallback to simple truncation
    if (this.conversation.title === 'New Conversation') {
      this.conversation.title = this.plugin.storage.generateTitle(userMessage);
      this.updateTitle();
    }
  }

  private setProcessing(processing: boolean): void {
    this.isProcessing = processing;

    // Delegate to input area module
    if (this.inputModule) {
      this.inputModule.setProcessing(processing);
    }

    // Update status bar
    this.plugin.updateStatusBar(processing ? 'processing' : 'connected');
  }

  /**
   * Create a command context for the slash command system.
   */
  private createCommandContext(): ChatViewCommandContext {
    return {
      plugin: this.plugin,
      conversation: this.conversation,
      inputEl: this.inputEl,
      messagesContainer: this.messagesContainer,

      getMessageQueue: () => [],  // Legacy - queue is now handled by module
      isSearchVisible: () => this.searchVisible,

      showTemporaryStatus: (msg, type, duration) => this.showTemporaryStatus(msg, type, duration),
      setStatus: (msg, type) => this.setStatus(msg, type),
      renderAllMessages: () => this.renderAllMessages(),
      scrollToBottom: (force) => this.scrollToBottom(force),

      clearMessages: () => this._clearMessages(),
      newConversation: () => this._newConversation(),
      toggleSearch: () => this._toggleSearch(),
      clearQueue: () => this.clearQueue(),
      performSearch: (query) => {
        if (this.searchBarModule) {
          this.searchBarModule.show();
          this.searchBarModule.search(query);
        }
      },
      addTagToConversation: (tag) => this.addTagToConversation(tag),
      removeTagFromConversation: (tag) => this.removeTagFromConversation(tag),
      saveConversation: () => this.saveConversation(),
      exportConversation: () => this.exportConversation(),
      exportToClipboard: () => this.exportToClipboard(),
      exportToJson: () => this.exportToJson(),

      resizeInput: () => {
        if (this.inputModule) {
          this.inputModule.resize();
        }
      },
      focusInput: () => {
        if (this.inputModule) {
          this.inputModule.focus();
        }
      },
    };
  }

  /**
   * Handle slash commands like /clear, /new, /note, /help
   * Returns true if the command was handled, false if it should be sent as a message
   */
  private async handleSlashCommand(input: string): Promise<boolean> {
    // Try the modular command system first
    const ctx = this.createCommandContext();
    const handled = await executeCommand(input, ctx);
    if (handled) {
      return true;
    }

    // Fall back to inline handlers for complex commands not yet extracted
    const parts = input.slice(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    log.debug('Processing slash command (fallback)', { command, args });

    switch (command) {
      // Commands handled by modular system: clear, new, export, note, search,
      // queue, help, tag, tags, model, skills

      case 'history':
        await this._toggleHistory();
        return true;

      case 'pin':
        await this.plugin.storage.togglePin(this.conversation.id);
        this.conversation.pinned = !this.conversation.pinned;
        this.showTemporaryStatus(
          this.conversation.pinned ? 'Conversation pinned' : 'Conversation unpinned',
          'success',
          1500
        );
        return true;

      case 'rename': {
        if (args) {
          await this.plugin.storage.renameConversation(this.conversation.id, args);
          this.conversation.title = args;
          this.updateTitle();
          this.showTemporaryStatus('Conversation renamed', 'success', 1500);
        } else {
          this.promptRenameConversation(this.conversation.id, this.conversation.title);
        }
        return true;
      }

      case 'stats': {
        const msgCount = this.conversation.messages.length;
        const userMsgs = this.conversation.messages.filter(m => m.role === 'user').length;
        const assistantMsgs = this.conversation.messages.filter(m => m.role === 'assistant').length;
        const tokens = this.estimateTokens();
        const upVotes = this.conversation.messages.filter(m => m.reaction === 'up').length;
        const downVotes = this.conversation.messages.filter(m => m.reaction === 'down').length;
        const created = new Date(this.conversation.createdAt).toLocaleDateString();

        // Include usage if available
        const usage = this.conversation.usage ?? calculateConversationUsage(this.conversation.messages);
        const usageLines = usage.totalCost > 0 ? `
- Input tokens: ${usage.totalInputTokens.toLocaleString()}
- Output tokens: ${usage.totalOutputTokens.toLocaleString()}
- Total cost: $${usage.totalCost.toFixed(4)}` : '';

        const statsText = `
**Conversation Stats:**
- Messages: ${msgCount} (${userMsgs} user, ${assistantMsgs} assistant)
- Est. tokens: ~${tokens.toLocaleString()}${usageLines}
- Created: ${created}
- Pinned: ${this.conversation.pinned ? 'Yes' : 'No'}
- Tags: ${(this.conversation.tags || []).join(', ') || 'None'}
- Reactions: ${upVotes} 👍 / ${downVotes} 👎
        `.trim();

        const statsMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: statsText,
          timestamp: Date.now(),
        };
        this.renderMessage(statsMsg);
        this.scrollToBottom(true);
        return true;
      }

      case 'usage': {
        // Show detailed usage across all conversations
        await this.showUsageDashboard();
        return true;
      }

      case 'copy': {
        // Copy entire conversation to clipboard as markdown
        const lines: string[] = [];
        lines.push(`# ${this.conversation.title}`);
        lines.push('');

        for (const msg of this.conversation.messages) {
          const role = msg.role === 'user' ? 'You' : 'Claude';
          lines.push(`**${role}:**`);
          lines.push(msg.content);
          lines.push('');
        }

        await navigator.clipboard.writeText(lines.join('\n'));
        this.showTemporaryStatus('Conversation copied to clipboard', 'success', 2000);
        return true;
      }

      case 'tools': {
        if (!args) {
          const tools = this.plugin.settings.allowedTools;
          this.showTemporaryStatus(`Allowed tools: ${tools.join(', ')}`, 'info', 3000);
        } else if (args === 'show' || args === 'on') {
          this.plugin.settings.showToolCalls = true;
          await this.plugin.saveSettings();
          this.showTemporaryStatus('Tool calls visible', 'success', 1500);
        } else if (args === 'hide' || args === 'off') {
          this.plugin.settings.showToolCalls = false;
          await this.plugin.saveSettings();
          this.showTemporaryStatus('Tool calls hidden', 'success', 1500);
        }
        return true;
      }

      case 'context': {
        // Toggle active note context
        if (args === 'on') {
          this.plugin.settings.activeNoteContext = true;
          await this.plugin.saveSettings();
          this.updateContextBadge();
          this.showTemporaryStatus('Active note context enabled', 'success', 1500);
        } else if (args === 'off') {
          this.plugin.settings.activeNoteContext = false;
          await this.plugin.saveSettings();
          this.updateContextBadge();
          this.showTemporaryStatus('Active note context disabled', 'success', 1500);
        } else {
          const status = this.plugin.settings.activeNoteContext ? 'enabled' : 'disabled';
          this.showTemporaryStatus(`Active note context: ${status}`, 'info', 2000);
        }
        return true;
      }

      case 'duplicate':
      case 'fork': {
        const newConv = await this.plugin.storage.duplicateConversation(this.conversation.id);
        if (newConv) {
          // If we have an SDK session, mark that the next message should fork it
          const sessionId = this.conversation.metadata?.sessionId;
          if (sessionId && this.getBackend().type === 'sdk') {
            // Store the session to fork from in the new conversation's metadata
            if (!newConv.metadata) {
              newConv.metadata = { backendType: 'sdk' };
            }
            newConv.metadata.forkFromSessionId = sessionId;
            await this.plugin.storage.saveConversation(newConv);
            this.showTemporaryStatus('Conversation forked - SDK session will branch on next message', 'success', 3000);
          } else {
            this.showTemporaryStatus('Conversation duplicated - now editing copy', 'success', 2000);
          }
          this.conversation = newConv;
          await this.plugin.storage.setCurrentConversationId(newConv.id);
          this.renderAllMessages();
          this.updateTitle();
        }
        return true;
      }

      case 'bookmarks': {
        const bookmarked = this.conversation.messages.filter(m => m.bookmarked);
        if (bookmarked.length === 0) {
          this.showTemporaryStatus('No bookmarked messages. Click ★ on a message to bookmark it.', 'info', 3000);
        } else {
          const summaryLines = bookmarked.map((m, i) => {
            const preview = m.content.slice(0, 60).replace(/\n/g, ' ');
            const role = m.role === 'user' ? 'You' : 'Claude';
            return `${i + 1}. **${role}**: ${preview}${m.content.length > 60 ? '...' : ''}`;
          });

          const bookmarkMsg: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: `**Bookmarked Messages (${bookmarked.length}):**\n\n${summaryLines.join('\n')}`,
            timestamp: Date.now(),
          };
          this.renderMessage(bookmarkMsg);
          this.scrollToBottom(true);
        }
        return true;
      }

      case 'help':
      case '?':
        this.showSlashCommandHelp();
        return true;

      case 'prompts':
      case 'prompt': {
        await this.handlePromptsCommand(args);
        return true;
      }

      case 'undo': {
        await this.handleUndoCommand(args);
        return true;
      }

      case 'budget': {
        await this.handleBudgetCommand(args);
        return true;
      }

      case 'cost': {
        // Quick cost summary for current conversation
        const usage = this.conversation.usage;
        if (!usage || usage.totalCost === 0) {
          this.showTemporaryStatus('No usage data yet for this conversation', 'info', 2000);
        } else {
          const inputK = Math.round(usage.totalInputTokens / 1000);
          const outputK = Math.round(usage.totalOutputTokens / 1000);
          this.showTemporaryStatus(
            `Cost: $${usage.totalCost.toFixed(4)} (${inputK}K in / ${outputK}K out)`,
            'info',
            4000
          );
        }
        return true;
      }

      case 'savenote':
      case 'save-note':
      case 'generate-note': {
        await this.generateNoteFromConversation(args);
        return true;
      }

      case 'skills': {
        this.showSkillsList();
        return true;
      }

      case 'mode':
      case 'permission': {
        await this.handlePermissionModeCommand(args);
        return true;
      }

      case 'mcp': {
        await this.handleMcpCommand(args);
        return true;
      }

      case 'extract':
      case 'extract-tasks': {
        await this.handleExtractCommand(args);
        return true;
      }

      case 'analyze':
      case 'analyze-note': {
        await this.handleAnalyzeNoteCommand(args);
        return true;
      }

      default:
        // Unknown command - show help hint
        this.showTemporaryStatus(`Unknown command: /${command}. Type /help for available commands.`, 'info');
        return true;
    }
  }

  /**
   * Handle /undo command to rewind file changes to a previous checkpoint.
   * Requires SDK backend with file checkpointing enabled.
   */
  private async handleUndoCommand(args: string): Promise<void> {
    const backend = this.plugin.agentManager?.getBackend();

    // Check if we have SDK backend
    if (!backend || backend.type !== 'sdk') {
      this.showTemporaryStatus('Undo requires SDK backend (not available on mobile)', 'info', 3000);
      return;
    }

    // Check if file checkpointing is enabled
    if (!this.plugin.settings.enableFileCheckpointing) {
      this.showTemporaryStatus('File checkpointing is disabled. Enable it in settings to use /undo', 'info', 3000);
      return;
    }

    // Find messages with SDK UUIDs (checkpoints)
    const checkpoints = this.conversation.messages
      .filter(m => m.sdkUuid && m.role === 'assistant')
      .map((m, index) => ({
        uuid: m.sdkUuid!,
        timestamp: m.timestamp,
        preview: m.content.slice(0, 80).replace(/\n/g, ' ') + (m.content.length > 80 ? '...' : ''),
        index,
      }));

    if (checkpoints.length === 0) {
      this.showTemporaryStatus('No checkpoints available. File changes are tracked after each message.', 'info', 3000);
      return;
    }

    const isDryRun = args.includes('--dry-run') || args.includes('-n');

    // If no specific checkpoint requested, show list
    if (!args || isDryRun) {
      const sdkBackend = backend as import('./backends/sdkAgentBackend').SDKAgentBackend;

      // Default to most recent checkpoint
      const latest = checkpoints[checkpoints.length - 1];

      // Do a dry run first to show what would change
      const result = await sdkBackend.rewindFiles(latest.uuid, true);

      if (!result || !result.canRewind) {
        this.showTemporaryStatus(result?.error || 'Cannot rewind to this checkpoint', 'error', 3000);
        return;
      }

      const filesChanged = result.filesChanged?.length || 0;
      const insertions = result.insertions || 0;
      const deletions = result.deletions || 0;

      if (filesChanged === 0) {
        this.showTemporaryStatus('No file changes to undo', 'info', 3000);
        return;
      }

      if (isDryRun) {
        // Just show what would happen
        const changesMsg = `Would restore ${filesChanged} file(s): +${insertions}/-${deletions} lines`;
        this.showTemporaryStatus(changesMsg, 'info', 5000);
        return;
      }

      // Actually perform the rewind
      const actualResult = await sdkBackend.rewindFiles(latest.uuid, false);

      if (actualResult?.canRewind) {
        const changesMsg = `Restored ${filesChanged} file(s): +${insertions}/-${deletions} lines`;
        this.showTemporaryStatus(changesMsg, 'success', 3000);
        log.info('Files rewound successfully', { uuid: latest.uuid, result: actualResult });
      } else {
        this.showTemporaryStatus(actualResult?.error || 'Failed to rewind files', 'error', 3000);
      }
    }
  }

  /**
   * Handle /budget command for spending limits.
   */
  private async handleBudgetCommand(args: string): Promise<void> {
    const currentUsage = this.conversation.usage;
    const currentCost = currentUsage?.totalCost ?? 0;
    const currentLimit = this.plugin.settings.maxBudgetUsd;

    if (!args || args === 'show') {
      // Show current budget status
      const limitStr = currentLimit ? `$${currentLimit.toFixed(2)}` : 'No limit';
      const spentStr = `$${currentCost.toFixed(4)}`;
      const remaining = currentLimit ? Math.max(0, currentLimit - currentCost) : null;
      const remainingStr = remaining !== null ? `$${remaining.toFixed(4)}` : '∞';
      const pct = currentLimit ? Math.round((currentCost / currentLimit) * 100) : 0;

      let status = `Budget: ${spentStr} spent`;
      if (currentLimit) {
        status += ` / ${limitStr} (${pct}% used, ${remainingStr} remaining)`;
        if (pct >= 80) {
          status += ' ⚠️';
        }
      } else {
        status += ' (no limit set)';
      }
      this.showTemporaryStatus(status, 'info', 5000);

    } else if (args.startsWith('set ')) {
      // Set budget limit
      const valueStr = args.slice(4).trim().replace('$', '');
      const value = parseFloat(valueStr);

      if (isNaN(value) || value <= 0) {
        this.showTemporaryStatus('Invalid budget. Use: /budget set 5.00', 'error', 3000);
        return;
      }

      this.plugin.settings.maxBudgetUsd = value;
      await this.plugin.saveSettings();
      this.showTemporaryStatus(`Budget limit set to $${value.toFixed(2)}`, 'success', 3000);

    } else if (args === 'clear' || args === 'remove') {
      // Remove budget limit
      this.plugin.settings.maxBudgetUsd = undefined;
      await this.plugin.saveSettings();
      this.showTemporaryStatus('Budget limit removed', 'success', 3000);

    } else {
      this.showTemporaryStatus('Usage: /budget, /budget set <amount>, /budget clear', 'info', 3000);
    }
  }

  /**
   * Handle /prompts command for managing saved prompts.
   */
  private async handlePromptsCommand(args: string): Promise<void> {
    const parts = args.trim().split(/\s+/);
    const action = parts[0]?.toLowerCase();
    const nameArg = parts.slice(1).join(' ');

    const savedPrompts = this.plugin.settings.savedPrompts || [];

    // /prompts - list all
    if (!action || action === 'list') {
      if (savedPrompts.length === 0) {
        this.showTemporaryStatus('No saved prompts. Use /prompts save <name> to create one.', 'info', 3000);
        return;
      }

      const lines: string[] = ['**Saved Prompts:**\n'];
      const byCategory = new Map<string, typeof savedPrompts>();

      for (const prompt of savedPrompts) {
        const cat = prompt.category || 'General';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(prompt);
      }

      for (const [category, prompts] of byCategory) {
        lines.push(`**${category}:**`);
        for (const p of prompts) {
          const preview = p.content.slice(0, 50).replace(/\n/g, ' ') + (p.content.length > 50 ? '...' : '');
          lines.push(`- **${p.name}**: ${preview}`);
        }
        lines.push('');
      }

      lines.push('*Use `/prompts use <name>` to insert a prompt*');

      const msg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: lines.join('\n'),
        timestamp: Date.now(),
      };
      this.renderMessage(msg);
      this.scrollToBottom(true);
      return;
    }

    // /prompts use <name>
    if (action === 'use' && nameArg) {
      const prompt = savedPrompts.find(p => p.name.toLowerCase() === nameArg.toLowerCase());
      if (!prompt) {
        this.showTemporaryStatus(`Prompt "${nameArg}" not found`, 'error', 2000);
        return;
      }

      // Replace variables
      let content = prompt.content;
      const activeFile = this.plugin.app.workspace.getActiveFile();

      // {{selection}} - Editor selection
      const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView?.editor) {
        content = content.replace(/\{\{selection\}\}/gi, activeView.editor.getSelection() || '');
      }

      // {{note}} - Current note content
      if (activeFile) {
        const noteContent = await this.plugin.app.vault.cachedRead(activeFile);
        content = content.replace(/\{\{note\}\}/gi, noteContent.slice(0, 8000));
        content = content.replace(/\{\{note_title\}\}/gi, activeFile.basename);
      }

      // {{clipboard}} - Clipboard content
      try {
        const clipboardText = await navigator.clipboard.readText();
        content = content.replace(/\{\{clipboard\}\}/gi, clipboardText);
      } catch {
        content = content.replace(/\{\{clipboard\}\}/gi, '');
      }

      this.inputEl.value = content;
      this.inputEl.focus();
      this.showTemporaryStatus(`Loaded prompt: ${prompt.name}`, 'success', 2000);
      return;
    }

    // /prompts save <name> [category]
    if (action === 'save' && nameArg) {
      const currentInput = this.inputEl.value.trim();
      if (!currentInput) {
        this.showTemporaryStatus('Nothing to save. Enter text in input first.', 'error', 2000);
        return;
      }

      // Parse name and optional category: "name | category"
      const [name, category] = nameArg.split('|').map(s => s.trim());

      // Check for duplicate
      const existingIdx = savedPrompts.findIndex(p => p.name.toLowerCase() === name.toLowerCase());

      const newPrompt: import('./types').SavedPrompt = {
        id: generateId(),
        name,
        category: category || 'General',
        content: currentInput,
        variables: this.extractVariables(currentInput),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      if (existingIdx >= 0) {
        savedPrompts[existingIdx] = { ...savedPrompts[existingIdx], ...newPrompt, id: savedPrompts[existingIdx].id, createdAt: savedPrompts[existingIdx].createdAt };
      } else {
        savedPrompts.push(newPrompt);
      }

      this.plugin.settings.savedPrompts = savedPrompts;
      await this.plugin.saveSettings();
      this.showTemporaryStatus(`Saved prompt: ${name}`, 'success', 2000);
      return;
    }

    // /prompts delete <name>
    if ((action === 'delete' || action === 'remove') && nameArg) {
      const idx = savedPrompts.findIndex(p => p.name.toLowerCase() === nameArg.toLowerCase());
      if (idx < 0) {
        this.showTemporaryStatus(`Prompt "${nameArg}" not found`, 'error', 2000);
        return;
      }

      savedPrompts.splice(idx, 1);
      this.plugin.settings.savedPrompts = savedPrompts;
      await this.plugin.saveSettings();
      this.showTemporaryStatus(`Deleted prompt: ${nameArg}`, 'success', 2000);
      return;
    }

    this.showTemporaryStatus('Usage: /prompts, /prompts use <name>, /prompts save <name>, /prompts delete <name>', 'info', 4000);
  }

  /**
   * Extract variable placeholders from prompt content.
   */
  private extractVariables(content: string): string[] {
    const matches = content.match(/\{\{(\w+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches.map(m => m.slice(2, -2)))];
  }

  private showSlashCommandHelp(): void {
    const helpText = `
**Conversation:**
- \`/new\` - Start new conversation
- \`/clear\` - Clear all messages
- \`/copy\` - Copy conversation to clipboard
- \`/export\` - Export as markdown note
- \`/export clipboard\` - Copy conversation to clipboard
- \`/export json\` - Export as JSON file
- \`/duplicate\` - Fork conversation (create editable copy)
- \`/undo\` - Rewind file changes to last checkpoint (SDK only)
- \`/undo --dry-run\` - Preview what /undo would restore
- \`/budget\` - Show current spend and limit
- \`/budget set <amount>\` - Set spending limit (e.g., /budget set 5.00)
- \`/budget clear\` - Remove spending limit
- \`/cost\` - Quick cost summary for this conversation
- \`/stats\` - Show conversation statistics
- \`/usage\` - Show usage dashboard (costs across conversations)
- \`/rename [title]\` - Rename conversation
- \`/pin\` - Toggle pin status

**Tags:**
- \`/tag\` - Show current tags
- \`/tag <name>\` - Add a tag
- \`/tag remove <name>\` - Remove a tag
- \`/tag list\` - All tags across conversations

**Settings:**
- \`/model [name]\` - Show/switch model (sonnet, opus)
- \`/tools [show|hide]\` - Toggle tool call visibility
- \`/context [on|off]\` - Toggle active note context

**Context:**
- \`/note [question]\` - Insert current note
- \`/search <query>\` - Search messages
- \`/queue [clear]\` - Message queue status
- \`/bookmarks\` - Show bookmarked messages

**Export:**
- \`/savenote [format] [path]\` - Save conversation as note
  - Formats: full (default), summary, q-and-a
  - Example: \`/savenote q-and-a research/meeting.md\`

**Skills:**
- \`/skills\` - List available skills and their triggers

**Prompts:**
- \`/prompts\` - List saved prompt templates
- \`/prompts use <name>\` - Insert a saved prompt
- \`/prompts save <name>\` - Save current input as prompt
- \`/prompts delete <name>\` - Delete a saved prompt

**Permissions (SDK only):**
- \`/mode\` - Show current permission mode
- \`/mode <mode>\` - Switch mode (default, acceptEdits, plan, etc.)

**MCP Servers (SDK only):**
- \`/mcp\` - Show MCP server status
- \`/mcp reconnect <name>\` - Reconnect failed server
- \`/mcp toggle <name>\` - Enable/disable server
- \`/mcp add <name> <cmd> [args]\` - Add server dynamically
- \`/mcp remove <name>\` - Remove/disable server

**Structured Analysis (SDK only):**
- \`/extract\` - Extract tasks, links, tags, and summary from current note
- \`/analyze\` - Analyze note for topics, sentiment, readability, and improvements

**Shortcuts:**
\`Enter\` send · \`Shift+Enter\` newline · \`↑↓\` history
\`Cmd+F\` search · \`Cmd+N\` new · \`Cmd+H\` history · \`Cmd+E\` export
\`Cmd+L\` focus input · \`Cmd+Shift+P\` pin · \`Esc\` close/focus
    `.trim();

    // Create a temporary system message to show help
    const helpMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: helpText,
      timestamp: Date.now(),
    };

    this.renderMessage(helpMsg);
    this.scrollToBottom(true);
  }

  /**
   * Handle /mcp command to show MCP server status and control servers.
   */
  private async handleMcpCommand(args: string): Promise<void> {
    const backend = this.getBackend();
    if (backend.type !== 'sdk') {
      this.showTemporaryStatus('MCP status requires SDK backend', 'info', 3000);
      return;
    }

    const factory = this.plugin.backendFactory;
    if (!factory) {
      this.showTemporaryStatus('Backend not initialized', 'error', 3000);
      return;
    }

    // Parse command: /mcp, /mcp reconnect <name>, /mcp toggle <name>, /mcp add <name> <command> [args...]
    const parts = args.trim().split(/\s+/);
    const action = parts[0]?.toLowerCase();
    const serverName = parts[1];

    // /mcp reconnect <name>
    if (action === 'reconnect' && serverName) {
      const success = await factory.reconnectMcpServer(serverName);
      this.showTemporaryStatus(
        success ? `Reconnected ${serverName}` : `Failed to reconnect ${serverName}`,
        success ? 'success' : 'error',
        2000
      );
      return;
    }

    // /mcp toggle|enable|disable <name>
    if ((action === 'toggle' || action === 'enable' || action === 'disable') && serverName) {
      const enabled = action !== 'disable';
      const success = await factory.toggleMcpServer(serverName, enabled);
      this.showTemporaryStatus(
        success ? `${serverName} ${enabled ? 'enabled' : 'disabled'}` : `Failed to toggle ${serverName}`,
        success ? 'success' : 'error',
        2000
      );
      return;
    }

    // /mcp add <name> <command> [args...] - Add a new MCP server dynamically
    if (action === 'add' && serverName && parts[2]) {
      const command = parts[2];
      const serverArgs = parts.slice(3);

      // Get current servers and add the new one
      const currentStatus = await factory.getMcpServerStatus();
      const currentServers: Record<string, { command: string; args: string[] }> = {};

      // Preserve existing servers
      if (currentStatus) {
        for (const server of currentStatus) {
          if (server.status !== 'disabled') {
            // We don't have the full config, so we'll just set the new server
            // The SDK will merge with existing
          }
        }
      }

      // Add the new server
      currentServers[serverName] = { command, args: serverArgs };

      const result = await factory.setMcpServers(currentServers);
      if (result) {
        if (result.errors[serverName]) {
          this.showTemporaryStatus(`Failed to add ${serverName}: ${result.errors[serverName]}`, 'error', 3000);
        } else if (result.added.includes(serverName)) {
          this.showTemporaryStatus(`Added MCP server: ${serverName}`, 'success', 2000);
        } else {
          this.showTemporaryStatus(`Server ${serverName} already exists`, 'info', 2000);
        }
      } else {
        this.showTemporaryStatus('No active session - start a conversation first', 'error', 3000);
      }
      return;
    }

    // /mcp remove <name> - Remove an MCP server
    if (action === 'remove' && serverName) {
      // To remove, we set servers without the one to remove
      // This requires knowing current config which we don't have - use toggle disable instead
      const success = await factory.toggleMcpServer(serverName, false);
      this.showTemporaryStatus(
        success ? `Disabled ${serverName}` : `Failed to disable ${serverName}`,
        success ? 'success' : 'error',
        2000
      );
      return;
    }

    // Default: show status
    const statuses = await factory.getMcpServerStatus();
    if (!statuses || statuses.length === 0) {
      this.showTemporaryStatus('No MCP servers configured or no active session', 'info', 3000);
      return;
    }

    const statusIcons: Record<string, string> = {
      connected: '🟢',
      failed: '🔴',
      'needs-auth': '🟡',
      pending: '⏳',
      disabled: '⚫',
    };

    const lines = ['**MCP Server Status:**\n'];
    for (const server of statuses) {
      const icon = statusIcons[server.status] || '❓';
      const tools = server.toolCount ? ` (${server.toolCount} tools)` : '';
      const error = server.error ? `\n  - Error: ${server.error}` : '';
      lines.push(`${icon} **${server.name}**: ${server.status}${tools}${error}`);
    }
    lines.push('');
    lines.push('*Commands: `/mcp reconnect|toggle|add|remove <name>`*');

    const mcpMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: lines.join('\n'),
      timestamp: Date.now(),
    };
    this.renderMessage(mcpMsg);
    this.scrollToBottom(true);
  }

  /**
   * Handle /mode command to change permission mode mid-conversation.
   */
  private async handlePermissionModeCommand(args: string): Promise<void> {
    const backend = this.getBackend();
    if (backend.type !== 'sdk') {
      this.showTemporaryStatus('Permission mode switching requires SDK backend', 'info', 3000);
      return;
    }

    const validModes = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk'] as const;
    type Mode = typeof validModes[number];

    if (!args) {
      // Show current mode and available options
      const current = this.plugin.settings.permissionMode;
      const modeDescriptions = {
        default: 'Prompt for dangerous operations',
        acceptEdits: 'Auto-accept file edits',
        bypassPermissions: 'Skip all checks (dangerous)',
        plan: 'Planning mode, no execution',
        dontAsk: 'Deny if not pre-approved',
      };

      const lines = [
        `**Current mode:** \`${current}\` - ${modeDescriptions[current as Mode] || 'Unknown'}`,
        '',
        '**Available modes:**',
        ...validModes.map((m) => `- \`/mode ${m}\` - ${modeDescriptions[m]}`),
      ];

      const modeMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: lines.join('\n'),
        timestamp: Date.now(),
      };
      this.renderMessage(modeMsg);
      this.scrollToBottom(true);
      return;
    }

    const mode = args.toLowerCase() as Mode;
    if (!validModes.includes(mode)) {
      this.showTemporaryStatus(`Invalid mode: ${args}. Use: ${validModes.join(', ')}`, 'error', 3000);
      return;
    }

    // Check for SDK-specific method
    const sdkBackend = backend as { setPermissionMode?: (mode: Mode) => Promise<boolean> };
    if (!sdkBackend.setPermissionMode) {
      this.showTemporaryStatus('setPermissionMode not available on this backend', 'error', 3000);
      return;
    }

    const success = await sdkBackend.setPermissionMode(mode);
    if (success) {
      // Also update settings so it persists
      this.plugin.settings.permissionMode = mode;
      await this.plugin.saveSettings();
      this.showTemporaryStatus(`Permission mode changed to: ${mode}`, 'success', 2000);
    } else {
      this.showTemporaryStatus('Failed to change permission mode (no active session)', 'error', 3000);
    }
  }

  /**
   * Handle /extract command to extract structured data from notes using JSON Schema.
   * Requires SDK backend for structured output support.
   */
  private async handleExtractCommand(args: string): Promise<void> {
    const backend = this.getBackend();
    if (backend.type !== 'sdk') {
      this.showTemporaryStatus('Structured extraction requires SDK backend', 'info', 3000);
      return;
    }

    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (!activeFile) {
      this.showTemporaryStatus('No active note to extract from', 'info', 2000);
      return;
    }

    const content = await this.plugin.app.vault.read(activeFile);

    // Define the extraction schema for tasks, links, and summary
    const extractionSchema = {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'List of tasks extracted from the note',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The task description' },
              completed: { type: 'boolean', description: 'Whether the task is marked complete' },
              priority: { type: 'string', enum: ['high', 'medium', 'low', 'none'], description: 'Task priority if specified' },
            },
            required: ['text', 'completed'],
          },
        },
        links: {
          type: 'array',
          description: 'Suggested internal links to other notes',
          items: {
            type: 'object',
            properties: {
              target: { type: 'string', description: 'The note or concept to link to' },
              reason: { type: 'string', description: 'Why this link would be useful' },
            },
            required: ['target', 'reason'],
          },
        },
        summary: {
          type: 'string',
          description: 'A brief 1-2 sentence summary of the note content',
        },
        tags: {
          type: 'array',
          description: 'Suggested tags for the note',
          items: { type: 'string' },
        },
      },
      required: ['tasks', 'links', 'summary', 'tags'],
    };

    // Show processing status
    this.setProcessing(true);
    this.setStatus('Extracting structured data...', 'info');

    let extractedOutput: unknown = null;

    const callbacks: AgentCallbacks = {
      onMessage: (msg) => {
        this.conversation.messages.push(msg);
        this.renderMessage(msg);
        this.scrollToBottom();
      },
      onStreamingUpdate: (messageId, newContent) => {
        const msg = this.conversation.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.content = newContent;
        }
        this.updateMessageContent(messageId, newContent);
      },
      onToolCall: (messageId, toolCall) => {
        this.updateMessageTools(messageId, [toolCall]);
      },
      onToolResult: () => {},
      onSessionInit: (sessionId, tools) => {
        log.debug('Extract session init', { sessionId, toolCount: tools.length });
      },
      onComplete: (result) => {
        this.setProcessing(false);
        this.setStatus('', 'info');
        if (result.structuredOutput) {
          extractedOutput = result.structuredOutput;
          this.displayExtractedData(activeFile.basename, extractedOutput);
        } else {
          this.showTemporaryStatus('No structured output returned', 'info', 3000);
        }
        this.saveConversation();
      },
      onError: (error) => {
        this.setProcessing(false);
        this.setStatus('', 'error');
        this.showTemporaryStatus(`Extraction failed: ${error.message}`, 'error', 5000);
      },
      onStructuredOutput: (output) => {
        extractedOutput = output;
      },
    };

    const prompt = `Analyze the following note content and extract structured information.
Extract all tasks (with completion status), suggest relevant internal links, provide a brief summary, and suggest tags.

Note: "${activeFile.basename}"
---
${content}
---`;

    try {
      await backend.sendMessage(prompt, this.conversation, callbacks, {
        outputFormat: { type: 'json_schema', schema: extractionSchema },
        maxTurns: 1,
        displayContent: `/extract from "${activeFile.basename}"`,
      });
    } catch (error) {
      log.error('Extract command failed', error);
      this.setProcessing(false);
    }
  }

  /**
   * Display extracted structured data in a readable format.
   */
  private displayExtractedData(noteName: string, data: unknown): void {
    const extracted = data as {
      tasks?: Array<{ text: string; completed: boolean; priority?: string }>;
      links?: Array<{ target: string; reason: string }>;
      summary?: string;
      tags?: string[];
    };

    const lines: string[] = [`**Extracted from "${noteName}":**\n`];

    if (extracted.summary) {
      lines.push(`📝 **Summary:** ${extracted.summary}\n`);
    }

    if (extracted.tasks && extracted.tasks.length > 0) {
      lines.push('**Tasks:**');
      for (const task of extracted.tasks) {
        const status = task.completed ? '✅' : '⬜';
        const priority = task.priority && task.priority !== 'none' ? ` [${task.priority}]` : '';
        lines.push(`- ${status} ${task.text}${priority}`);
      }
      lines.push('');
    }

    if (extracted.links && extracted.links.length > 0) {
      lines.push('**Suggested Links:**');
      for (const link of extracted.links) {
        lines.push(`- [[${link.target}]] - ${link.reason}`);
      }
      lines.push('');
    }

    if (extracted.tags && extracted.tags.length > 0) {
      lines.push(`**Suggested Tags:** ${extracted.tags.map(t => `#${t}`).join(' ')}`);
    }

    const extractMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: lines.join('\n'),
      timestamp: Date.now(),
    };
    this.renderMessage(extractMsg);
    this.scrollToBottom(true);
  }

  /**
   * Handle /analyze command to get structured analysis of a note.
   * Requires SDK backend for structured output support.
   */
  private async handleAnalyzeNoteCommand(args: string): Promise<void> {
    const backend = this.getBackend();
    if (backend.type !== 'sdk') {
      this.showTemporaryStatus('Structured analysis requires SDK backend', 'info', 3000);
      return;
    }

    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (!activeFile) {
      this.showTemporaryStatus('No active note to analyze', 'info', 2000);
      return;
    }

    const content = await this.plugin.app.vault.read(activeFile);

    // Define analysis schema
    const analysisSchema = {
      type: 'object',
      properties: {
        topics: {
          type: 'array',
          description: 'Main topics covered in the note',
          items: { type: 'string' },
        },
        sentiment: {
          type: 'string',
          enum: ['positive', 'neutral', 'negative', 'mixed'],
          description: 'Overall sentiment of the content',
        },
        readability: {
          type: 'object',
          properties: {
            level: { type: 'string', enum: ['simple', 'moderate', 'complex', 'technical'] },
            score: { type: 'number', minimum: 1, maximum: 10 },
          },
          required: ['level', 'score'],
        },
        structure: {
          type: 'object',
          properties: {
            hasHeadings: { type: 'boolean' },
            hasTasks: { type: 'boolean' },
            hasLinks: { type: 'boolean' },
            hasCodeBlocks: { type: 'boolean' },
            wordCount: { type: 'number' },
          },
          required: ['hasHeadings', 'hasTasks', 'hasLinks', 'hasCodeBlocks', 'wordCount'],
        },
        improvements: {
          type: 'array',
          description: 'Suggestions for improving the note',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string', enum: ['structure', 'clarity', 'completeness', 'linking', 'metadata'] },
              suggestion: { type: 'string' },
            },
            required: ['category', 'suggestion'],
          },
        },
      },
      required: ['topics', 'sentiment', 'readability', 'structure', 'improvements'],
    };

    this.setProcessing(true);
    this.setStatus('Analyzing note...', 'info');

    const callbacks: AgentCallbacks = {
      onMessage: (msg) => {
        this.conversation.messages.push(msg);
        this.renderMessage(msg);
        this.scrollToBottom();
      },
      onStreamingUpdate: (messageId, newContent) => {
        const msg = this.conversation.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.content = newContent;
        }
        this.updateMessageContent(messageId, newContent);
      },
      onToolCall: (messageId, toolCall) => {
        this.updateMessageTools(messageId, [toolCall]);
      },
      onToolResult: () => {},
      onSessionInit: () => {},
      onComplete: (result) => {
        this.setProcessing(false);
        this.setStatus('', 'info');
        if (result.structuredOutput) {
          this.displayAnalysisData(activeFile.basename, result.structuredOutput);
        } else {
          this.showTemporaryStatus('No analysis data returned', 'info', 3000);
        }
        this.saveConversation();
      },
      onError: (error) => {
        this.setProcessing(false);
        this.setStatus('', 'error');
        this.showTemporaryStatus(`Analysis failed: ${error.message}`, 'error', 5000);
      },
      onStructuredOutput: () => {},
    };

    const prompt = `Analyze this note comprehensively. Identify main topics, assess sentiment and readability, describe the structure, and suggest improvements.

Note: "${activeFile.basename}"
---
${content}
---`;

    try {
      await backend.sendMessage(prompt, this.conversation, callbacks, {
        outputFormat: { type: 'json_schema', schema: analysisSchema },
        maxTurns: 1,
        displayContent: `/analyze "${activeFile.basename}"`,
      });
    } catch (error) {
      log.error('Analyze command failed', error);
      this.setProcessing(false);
    }
  }

  /**
   * Display note analysis data in a readable format.
   */
  private displayAnalysisData(noteName: string, data: unknown): void {
    const analysis = data as {
      topics?: string[];
      sentiment?: string;
      readability?: { level: string; score: number };
      structure?: {
        hasHeadings: boolean;
        hasTasks: boolean;
        hasLinks: boolean;
        hasCodeBlocks: boolean;
        wordCount: number;
      };
      improvements?: Array<{ category: string; suggestion: string }>;
    };

    const sentimentEmoji: Record<string, string> = {
      positive: '😊',
      neutral: '😐',
      negative: '😟',
      mixed: '🤔',
    };

    const lines: string[] = [`**Analysis of "${noteName}":**\n`];

    if (analysis.topics && analysis.topics.length > 0) {
      lines.push(`🏷️ **Topics:** ${analysis.topics.join(', ')}\n`);
    }

    if (analysis.sentiment) {
      const emoji = sentimentEmoji[analysis.sentiment] || '';
      lines.push(`${emoji} **Sentiment:** ${analysis.sentiment}\n`);
    }

    if (analysis.readability) {
      const score = '⭐'.repeat(Math.round(analysis.readability.score / 2));
      lines.push(`📖 **Readability:** ${analysis.readability.level} (${score} ${analysis.readability.score}/10)\n`);
    }

    if (analysis.structure) {
      const s = analysis.structure;
      const features = [];
      if (s.hasHeadings) features.push('headings');
      if (s.hasTasks) features.push('tasks');
      if (s.hasLinks) features.push('links');
      if (s.hasCodeBlocks) features.push('code');
      lines.push(`📊 **Structure:** ${s.wordCount} words | Features: ${features.join(', ') || 'basic'}\n`);
    }

    if (analysis.improvements && analysis.improvements.length > 0) {
      lines.push('💡 **Suggestions:**');
      for (const imp of analysis.improvements) {
        lines.push(`- **${imp.category}:** ${imp.suggestion}`);
      }
    }

    const analysisMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: lines.join('\n'),
      timestamp: Date.now(),
    };
    this.renderMessage(analysisMsg);
    this.scrollToBottom(true);
  }

  /**
   * Show the list of available skills.
   */
  private showSkillsList(): void {
    const skills = this.plugin.skillRegistry.getSkills();

    if (!this.plugin.settings.skills.enabled) {
      this.showTemporaryStatus('Skills are disabled. Enable them in settings.', 'info', 3000);
      return;
    }

    if (skills.length === 0) {
      this.showTemporaryStatus(
        `No skills found. Add SKILL.md files to ${this.plugin.settings.skills.folderPath}`,
        'info',
        3000
      );
      return;
    }

    // Build skills display
    const lines: string[] = ['**Available Skills:**\n'];

    // Group skills by always-active vs triggered
    const alwaysActive = skills.filter(s => s.alwaysActive);
    const triggered = skills.filter(s => !s.alwaysActive);

    if (alwaysActive.length > 0) {
      lines.push('**Always Active:**');
      for (const skill of alwaysActive) {
        lines.push(`- **${skill.name}**: ${skill.description}`);
      }
      lines.push('');
    }

    if (triggered.length > 0) {
      lines.push('**Triggered by Keywords:**');
      for (const skill of triggered) {
        const triggers = skill.triggers.slice(0, 3).join(', ');
        const moreCount = skill.triggers.length > 3 ? ` +${skill.triggers.length - 3} more` : '';
        lines.push(`- **${skill.name}**: ${skill.description}`);
        if (triggers) {
          lines.push(`  - *Triggers:* ${triggers}${moreCount}`);
        }
      }
    }

    lines.push('');
    lines.push(`*Skills folder: \`${this.plugin.settings.skills.folderPath}\`*`);

    const skillsMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: lines.join('\n'),
      timestamp: Date.now(),
    };

    this.renderMessage(skillsMsg);
    this.scrollToBottom(true);
  }

  /**
   * Generate a note from the current conversation.
   * Supports formats: full (default), summary, q-and-a
   */
  private async generateNoteFromConversation(args: string): Promise<void> {
    if (this.conversation.messages.length === 0) {
      this.showTemporaryStatus('No messages to save', 'info', 2000);
      return;
    }

    // Parse args: /savenote [format] [folder/filename]
    const parts = args.split(/\s+/);
    let format = 'full';
    let targetPath = '';

    for (const part of parts) {
      if (['full', 'summary', 'q-and-a', 'qa'].includes(part.toLowerCase())) {
        format = part.toLowerCase() === 'qa' ? 'q-and-a' : part.toLowerCase();
      } else if (part) {
        targetPath = part;
      }
    }

    // Generate default filename from conversation title
    const sanitizedTitle = this.conversation.title
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 50);
    const timestamp = new Date().toISOString().slice(0, 10);
    const defaultFilename = `${sanitizedTitle}-${timestamp}.md`;

    // If no path provided, use default
    if (!targetPath) {
      targetPath = defaultFilename;
    } else if (!targetPath.endsWith('.md')) {
      // If it looks like a folder, append filename
      targetPath = `${targetPath}/${defaultFilename}`;
    }

    // Normalize path (remove leading slash if present)
    targetPath = targetPath.replace(/^\//, '');

    // Generate note content based on format
    let content = '';
    const date = new Date(this.conversation.createdAt);

    // Frontmatter
    content += '---\n';
    content += `title: "${this.conversation.title}"\n`;
    content += `created: ${date.toISOString()}\n`;
    content += `source: claude-conversation\n`;
    if (this.conversation.tags && this.conversation.tags.length > 0) {
      content += `tags: [${this.conversation.tags.map(t => `"${t}"`).join(', ')}]\n`;
    }
    content += '---\n\n';

    if (format === 'full') {
      // Full transcript
      content += `# ${this.conversation.title}\n\n`;
      for (const msg of this.conversation.messages) {
        const role = msg.role === 'user' ? '**You**' : '**Claude**';
        content += `${role}:\n\n${msg.content}\n\n---\n\n`;
      }
    } else if (format === 'summary') {
      // Summary - just key points from assistant messages
      content += `# ${this.conversation.title} - Summary\n\n`;
      const assistantMsgs = this.conversation.messages.filter(m => m.role === 'assistant');
      if (assistantMsgs.length > 0) {
        // Take the last (or longest) assistant message as the main content
        const mainResponse = assistantMsgs.reduce((a, b) =>
          a.content.length > b.content.length ? a : b
        );
        content += mainResponse.content + '\n';
      }
    } else if (format === 'q-and-a') {
      // Q&A format - pair user questions with assistant answers
      content += `# ${this.conversation.title} - Q&A\n\n`;
      const messages = this.conversation.messages;
      for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === 'user') {
          const question = messages[i].content;
          // Find next assistant response
          const answer = messages[i + 1]?.role === 'assistant' ? messages[i + 1].content : '';
          if (answer) {
            content += `## Q: ${question.slice(0, 100)}${question.length > 100 ? '...' : ''}\n\n`;
            content += `${answer}\n\n`;
          }
        }
      }
    }

    // Create the file
    try {
      // Check if file already exists
      const existingFile = this.plugin.app.vault.getAbstractFileByPath(targetPath);
      if (existingFile) {
        this.showTemporaryStatus(`File already exists: ${targetPath}`, 'error', 3000);
        return;
      }

      // Ensure parent folder exists
      const folderPath = targetPath.substring(0, targetPath.lastIndexOf('/'));
      if (folderPath) {
        const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
        if (!folder) {
          await this.plugin.app.vault.createFolder(folderPath);
        }
      }

      // Create the note
      const file = await this.plugin.app.vault.create(targetPath, content);
      this.showTemporaryStatus(`Note created: ${file.path}`, 'success', 3000);

      // Optionally open the note
      const leaf = this.plugin.app.workspace.getLeaf(false);
      await leaf.openFile(file);

      log.info('Generated note from conversation', { path: targetPath, format });
    } catch (error) {
      log.error('Failed to create note', error);
      this.showTemporaryStatus(`Failed to create note: ${error}`, 'error', 3000);
    }
  }

  /**
   * Public method to send a message programmatically.
   * Used by command palette and context menu integrations.
   */
  public async sendMessage(message?: string): Promise<void> {
    const content = message ?? this.inputEl.value.trim();
    if (!content) return;

    // If called with a message, put it in the input first
    if (message) {
      this.inputEl.value = message;
    }

    // Check for slash commands (even when processing)
    if (content.startsWith('/')) {
      const handled = await this.handleSlashCommand(content);
      if (handled) {
        this.inputEl.value = '';
        return;
      }
    }

    // If already processing, add to queue instead of blocking
    if (this.isProcessing) {
      this.addToQueue(content);
      this.inputEl.value = '';
      return;
    }

    log.info('User sending message', { contentLength: content.length });

    // Add to input history via module
    if (this.inputModule) {
      this.inputModule.addToHistory(content);
      this.inputModule.clear();
    } else {
      this.inputEl.value = '';
    }
    this.setProcessing(true);
    this.setStatus('Thinking...', 'info');

    // Get the backend and update settings
    const backend = this.getBackend();
    backend.updateSettings(this.plugin.settings);

    // Check if model changed - if so, clear session to start fresh
    const currentModel = this.plugin.settings.model;
    const sessionModel = this.conversation.metadata?.model;
    if (sessionModel && sessionModel !== currentModel) {
      log.info('Model changed, starting fresh session', { from: sessionModel, to: currentModel });
      delete this.conversation.metadata?.sessionId;
      delete this.conversation.sessionId;
      this.showTemporaryStatus(`Switched to ${currentModel}`, 'info', 2000);
    }
    // Track the model used for this conversation
    if (!this.conversation.metadata) {
      this.conversation.metadata = { backendType: backend.type };
    }
    this.conversation.metadata.model = currentModel;

    // Track current assistant message for updates
    let currentAssistantMsgId: string | null = null;
    const currentToolCalls: ToolCallInfo[] = [];

    const callbacks: AgentCallbacks = {
      onMessage: (msg) => {
        this.conversation.messages.push(msg);
        this.renderMessage(msg);
        this.updateTokenCounter();

        if (msg.role === 'assistant') {
          currentAssistantMsgId = msg.id;
        }

        // Force scroll when user sends a message or assistant starts replying
        if (msg.role === 'user') {
          this.userScrolledUp = false;
        }
        this.scrollToBottom();
      },

      onStreamingUpdate: (messageId, content) => {
        // Update the message in our state
        const msg = this.conversation.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.content = content;
          msg.isStreaming = false;
        }

        this.updateMessageContent(messageId, content);
      },

      onToolCall: (messageId, toolCall) => {
        // Track tool calls
        const existing = currentToolCalls.find((t) => t.name === toolCall.name);
        if (existing) {
          Object.assign(existing, toolCall);
        } else {
          currentToolCalls.push(toolCall);
        }

        // Update message
        const msg = this.conversation.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.toolCalls = [...currentToolCalls];
        }

        this.updateMessageTools(messageId, currentToolCalls);
        this.setStatus(`Using tool: ${toolCall.name}`, 'info');
      },

      onToolResult: (messageId, toolName, result) => {
        const tool = currentToolCalls.find((t) => t.name === toolName);
        if (tool) {
          tool.result = result;
          tool.status = 'completed';
        }

        const msg = this.conversation.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.toolCalls = [...currentToolCalls];
        }

        this.updateMessageTools(messageId, currentToolCalls);
      },

      onSessionInit: (sessionId, tools) => {
        // Update metadata with session info
        if (!this.conversation.metadata) {
          this.conversation.metadata = { backendType: backend.type };
        }
        this.conversation.metadata.sessionId = sessionId;
        this.conversation.sessionId = sessionId; // Legacy support
        log.info('Session initialized', { sessionId, toolCount: tools.length, backendType: backend.type });
        log.debug('Available tools', { tools });
      },

      onComplete: async (result) => {
        this.setProcessing(false);

        // Refresh status bar (may have loaded account info during query)
        this.refreshStatusBar();

        // Capture usage data on the assistant message
        if (currentAssistantMsgId && (result.inputTokens || result.outputTokens)) {
          const msg = this.conversation.messages.find((m) => m.id === currentAssistantMsgId);
          if (msg) {
            const inputTokens = result.inputTokens ?? 0;
            const outputTokens = result.outputTokens ?? 0;
            const cost = result.totalCost ?? calculateCost(
              inputTokens,
              outputTokens,
              this.plugin.settings.model
            );
            msg.usage = { inputTokens, outputTokens, cost };
          }

          // Update conversation-level usage stats
          this.conversation.usage = calculateConversationUsage(this.conversation.messages);
        }

        if (result.success) {
          // Clear status - completion is evident from the message itself
          this.setStatus('');
          // Update token/cost display
          this.updateTokenCounter();
        } else {
          this.setStatus(
            `Errors: ${result.errors?.join(', ') || 'Unknown error'}`,
            'error'
          );
        }

        // Save conversation
        this.conversation.updatedAt = Date.now();
        await this.saveConversation();

        // Process next message in queue if any
        if (this.queueModule?.getCount() ?? 0 > 0) {
          // Small delay before processing next to allow UI to update
          setTimeout(() => this.processNextInQueue(), 500);
        }
      },

      onError: (error) => {
        this.setProcessing(false);
        log.error('Agent error during message processing', error);

        // Clean up error message - first line only, no stack traces
        const fullMsg = error.message || 'Unknown error';
        const firstLine = fullMsg.split('\n')[0].trim();
        const cleanMsg = firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine;

        // Check for session/model mismatch errors
        if (fullMsg.toLowerCase().includes('exited with code') || fullMsg.toLowerCase().includes('session')) {
          // Clear session and offer to retry
          delete this.conversation.metadata?.sessionId;
          delete this.conversation.sessionId;
          this.setStatus('Session error - try again', 'error');
          new Notice('Session ended. Please try again.', 3000);
        } else {
          this.setStatus(cleanMsg, 'error');
        }
      },

      onSdkUuid: (messageId, uuid) => {
        // Store SDK UUID for file checkpointing/rewind support
        const msg = this.conversation.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.sdkUuid = uuid;
          log.debug('Stored SDK UUID for message', { messageId, uuid });
        }
      },

      onToolSummary: (messageId, summary) => {
        // Store and display human-readable tool summary
        const msg = this.conversation.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.toolSummary = summary;
          this.updateToolSummary(messageId, summary);
          log.debug('Received tool summary', { messageId, summary });
        }
      },

      onFilesPersisted: (filenames) => {
        // Trigger vault refresh when Claude modifies files
        log.info('Files modified by Claude, refreshing vault', { count: filenames.length });

        // Schedule a vault refresh (debounced to avoid rapid refreshes)
        if (this.vaultRefreshTimeout) {
          clearTimeout(this.vaultRefreshTimeout);
        }
        this.vaultRefreshTimeout = setTimeout(() => {
          // Trigger Obsidian's file cache update
          this.plugin.app.vault.trigger('modify');
          log.debug('Vault refresh triggered');
        }, 500);
      },

      onTaskNotification: (taskId, status, summary, outputFile) => {
        // Handle background task (subagent) notifications
        log.info('Background task notification', { taskId, status, summary });
        this.handleTaskNotification(taskId, status, summary, outputFile, currentAssistantMsgId);
      },

      onCompactionStatus: (status) => {
        // Handle context compaction status changes
        if (status === 'compacting') {
          this.setStatus('Compacting context...', 'info');
          log.info('Context compaction started');
        } else {
          // Clear compaction status
          this.setStatus('', 'info');
          log.info('Context compaction completed');
        }
      },

      onCompactionBoundary: (trigger, preTokens) => {
        // Handle compaction boundary marker
        const tokensK = Math.round(preTokens / 1000);
        log.info('Context compacted', { trigger, preTokens, tokensK });

        // Show notification with token info
        new Notice(`Context compacted: was ~${tokensK}K tokens (${trigger})`, 3000);

        // Record compaction in conversation metadata
        if (!this.conversation.metadata) {
          this.conversation.metadata = {};
        }
        if (!this.conversation.metadata.compactions) {
          this.conversation.metadata.compactions = [];
        }
        this.conversation.metadata.compactions.push({
          timestamp: Date.now(),
          trigger,
          preTokens,
        });
        this.saveConversation();
      },
    };

    try {
      // Build enhanced system prompt with active skills
      const basePrompt = this.plugin.settings.systemPrompt;
      const enhancedPrompt = this.plugin.skillRegistry.buildSystemPrompt(
        basePrompt,
        content
      );

      // Build message with optional active note context
      // Priority: selected text > full/delta note content
      let messageContent = content;
      if (this.plugin.settings.activeNoteContext) {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === 'md') {
          const notePath = activeFile.path;

          // Check for selected text first - this takes priority
          const selection = this.getEditorSelection();
          if (selection) {
            // Include selected text with line range for context
            messageContent = `<selected_text path="${notePath}" lines="${selection.startLine}-${selection.endLine}">\n${selection.text}\n</selected_text>\n\n${content}`;
            log.debug('Included selected text', { path: notePath, lines: `${selection.startLine}-${selection.endLine}`, length: selection.text.length });
          } else {
            // No selection - use full note or delta
            const isNewNote = this.lastSentNotePath !== notePath;

            try {
              const noteContent = await this.plugin.app.vault.read(activeFile);

              if (isNewNote) {
                // Include full note content for new/different notes
                messageContent = `<active_note path="${notePath}">\n${noteContent}\n</active_note>\n\n${content}`;
                this.lastSentNotePath = notePath;
                this.lastSentNoteContent = noteContent;
                log.debug('Included active note context (new note)', { path: notePath, contentLength: noteContent.length });
              } else if (this.lastSentNoteContent && noteContent !== this.lastSentNoteContent) {
                // Same note but content changed - send only the delta if it's smaller
                const delta = this.computeNoteDelta(this.lastSentNoteContent, noteContent);
                if (delta && delta.length < noteContent.length) {
                  // Delta is smaller - send just the changes
                  messageContent = `<active_note_changes path="${notePath}">\n${delta}\n</active_note_changes>\n\n${content}`;
                  log.debug('Included note delta', { path: notePath, deltaLength: delta.length });
                } else if (delta) {
                  // Delta is larger than full content - resend full note
                  messageContent = `<active_note path="${notePath}">\n${noteContent}\n</active_note>\n\n${content}`;
                  log.debug('Resent full note (delta too large)', { path: notePath, contentLength: noteContent.length });
                }
                this.lastSentNoteContent = noteContent;
              }
              // If same note and no changes, just send the user's message
            } catch (err) {
              log.warn('Failed to read active note for context', { path: notePath, error: err });
            }
          }
        }
      }

      // Collect images from module and clear preview
      const moduleImages = this.inputModule?.getImages() ?? [];
      const images = moduleImages.length > 0
        ? moduleImages.map(img => ({ data: img.data, mimeType: img.mimeType, filename: img.filename }))
        : undefined;
      if (this.inputModule) {
        this.inputModule.clearImages();
      }

      // Check if we should fork from another session or resume at a specific point
      const forkFromSessionId = this.conversation.metadata?.forkFromSessionId;
      const resumeAtUuid = this.conversation.metadata?.resumeAtUuid;
      const resumeSessionId = forkFromSessionId || this.conversation.metadata?.sessionId || this.conversation.sessionId;

      await backend.sendMessage(
        messageContent,
        this.conversation,
        callbacks,
        {
          resumeSessionId,
          forkSession: !!forkFromSessionId,
          resumeSessionAt: resumeAtUuid,
          systemPrompt: enhancedPrompt,
          // Show only the user's input in UI, not the injected context
          displayContent: content !== messageContent ? content : undefined,
          images,
        }
      );

      // Clear the fork/resume flags after use (one-time)
      if ((forkFromSessionId || resumeAtUuid) && this.conversation.metadata) {
        delete this.conversation.metadata.forkFromSessionId;
        delete this.conversation.metadata.resumeAtUuid;
        await this.plugin.storage.saveConversation(this.conversation);
      }
    } catch (error) {
      callbacks.onError(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private stopGeneration(): void {
    if (this.messageOrchestrator) {
      this.messageOrchestrator.stop();
    } else {
      // Fallback for when orchestrator is not initialized
      log.info('User stopped generation');
      this.getBackend().abort();
      this.setProcessing(false);
      this.setStatus('Stopped', 'info');
    }
  }

  /**
   * Toggle voice input using Web Speech API
   */
  private toggleVoiceInput(): void {
    if (this.isRecording) {
      this.stopVoiceInput();
    } else {
      this.startVoiceInput();
    }
  }

  private startVoiceInput(): void {
    // Use webkit prefix for Safari/older Chrome, or standard API
    const SpeechRecognitionAPI = (window as unknown as { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      this.showTemporaryStatus('Voice input not supported in this browser', 'error');
      return;
    }

    this.speechRecognition = new SpeechRecognitionAPI();
    this.speechRecognition.continuous = true;
    this.speechRecognition.interimResults = true;
    this.speechRecognition.lang = 'en-US';

    let finalTranscript = this.inputEl.value;
    let interimTranscript = '';

    this.speechRecognition.onresult = (event: SpeechRecognitionEvent) => {
      interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += (finalTranscript ? ' ' : '') + transcript;
        } else {
          interimTranscript += transcript;
        }
      }
      // Show final + interim in input
      this.inputEl.value = finalTranscript + (interimTranscript ? ' ' + interimTranscript : '');
      if (this.inputModule) {
        this.inputModule.resize();
      }
    };

    this.speechRecognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      log.error('Speech recognition error', { error: event.error });
      this.stopVoiceInput();
      if (event.error === 'not-allowed') {
        this.showTemporaryStatus('Microphone access denied', 'error');
      } else {
        this.showTemporaryStatus(`Voice error: ${event.error}`, 'error');
      }
    };

    this.speechRecognition.onend = () => {
      // Auto-stop UI if recognition ends
      if (this.isRecording) {
        this.stopVoiceInput();
      }
    };

    try {
      this.speechRecognition.start();
      this.isRecording = true;
      if (this.inputModule) {
        this.inputModule.setRecording(true);
      }
      this.showTemporaryStatus('Listening...', 'info', 10000);
      log.info('Voice input started');
    } catch (error) {
      log.error('Failed to start voice input', error);
      this.showTemporaryStatus('Failed to start voice input', 'error');
    }
  }

  private stopVoiceInput(): void {
    if (this.speechRecognition) {
      this.speechRecognition.stop();
      this.speechRecognition = null;
    }
    this.isRecording = false;
    if (this.inputModule) {
      this.inputModule.setRecording(false);
    }
    this.setStatus('');
    log.info('Voice input stopped');
  }

  /**
   * Build context info for message orchestrator.
   * Delegates to contextModule for note tracking and delta computation.
   */
  private async buildContextInfo(): Promise<ContextInfo> {
    // Build enhanced system prompt with active skills
    const basePrompt = this.plugin.settings.systemPrompt;
    const inputValue = this.inputEl?.value ?? '';
    const enhancedPrompt = this.plugin.skillRegistry.buildSystemPrompt(
      basePrompt,
      inputValue
    );

    const contextInfo: ContextInfo = {
      systemPrompt: enhancedPrompt,
    };

    // Use context module to load active note context
    if (this.contextModule) {
      const result = await this.contextModule.load('');

      // Parse the result to extract structured context info
      // The module returns XML-formatted context, we need to extract the data
      if (result.messageContent !== '') {
        const selectedTextMatch = result.messageContent.match(
          /<selected_text path="([^"]+)" lines="(\d+)-(\d+)">\n([\s\S]*?)\n<\/selected_text>/
        );
        if (selectedTextMatch) {
          contextInfo.selectedText = {
            path: selectedTextMatch[1],
            startLine: parseInt(selectedTextMatch[2], 10),
            endLine: parseInt(selectedTextMatch[3], 10),
            text: selectedTextMatch[4],
          };
        }

        const activeNoteMatch = result.messageContent.match(
          /<active_note path="([^"]+)">\n([\s\S]*?)\n<\/active_note>/
        );
        if (activeNoteMatch) {
          contextInfo.activeNote = {
            path: activeNoteMatch[1],
            content: activeNoteMatch[2],
            isDelta: false,
          };
        }

        const deltaMatch = result.messageContent.match(
          /<active_note_changes path="([^"]+)">\n([\s\S]*?)\n<\/active_note_changes>/
        );
        if (deltaMatch) {
          contextInfo.activeNote = {
            path: deltaMatch[1],
            content: deltaMatch[2],
            isDelta: true,
          };
        }
      }
    }

    return contextInfo;
  }

  private async _newConversation(): Promise<void> {
    log.info('Creating new conversation');
    this.conversation = await this.plugin.storage.createConversation();
    this.lastSentNotePath = null; // Reset note tracking for new conversation
    this.lastSentNoteContent = null;
    this.renderAllMessages();
    this.updateTitle();
    this.setStatus('');

    // Close history panel if open
    if (this.historyModule?.isVisible()) {
      this.historyModule.hide();
    }

    this.inputEl.focus();
  }

  private async exportConversation(): Promise<void> {
    if (this.conversation.messages.length === 0) {
      this.showTemporaryStatus('No messages to export', 'info', 2000);
      return;
    }

    log.info('Exporting conversation', { id: this.conversation.id });

    // Build markdown content
    const lines: string[] = [];
    const date = new Date(this.conversation.createdAt);
    const dateStr = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Frontmatter
    lines.push('---');
    lines.push(`title: "${this.conversation.title}"`);
    lines.push(`date: ${date.toISOString()}`);
    lines.push('tags:');
    lines.push('  - claude-chat');
    lines.push('---');
    lines.push('');

    // Header
    lines.push(`# ${this.conversation.title}`);
    lines.push('');
    lines.push(`*Exported from Claude Chat on ${dateStr}*`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Messages
    for (const msg of this.conversation.messages) {
      const role = msg.role === 'user' ? '**You**' : '**Claude**';
      const time = new Date(msg.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });

      lines.push(`### ${role} *${time}*`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');

      // Include tool calls if present
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        lines.push('<details>');
        lines.push('<summary>Tool calls</summary>');
        lines.push('');
        for (const tool of msg.toolCalls) {
          lines.push(`- **${tool.name}**`);
          if (tool.result) {
            lines.push('  ```');
            lines.push(`  ${tool.result.slice(0, 200)}${tool.result.length > 200 ? '...' : ''}`);
            lines.push('  ```');
          }
        }
        lines.push('');
        lines.push('</details>');
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    const content = lines.join('\n');

    // Generate filename
    const sanitizedTitle = this.conversation.title
      .replace(/[\\/:*?"<>|]/g, '-')
      .slice(0, 50);
    const filename = `Claude Chat - ${sanitizedTitle}.md`;

    // Create in vault root or a claude-exports folder
    const folderPath = 'Claude Exports';
    const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      await this.plugin.app.vault.createFolder(folderPath);
    }

    const filePath = `${folderPath}/${filename}`;

    try {
      const existingFile = this.plugin.app.vault.getAbstractFileByPath(filePath);
      if (existingFile) {
        // Overwrite existing file
        await this.plugin.app.vault.modify(existingFile as import('obsidian').TFile, content);
      } else {
        await this.plugin.app.vault.create(filePath, content);
      }

      this.showTemporaryStatus(`Exported to "${filename}"`, 'success');

      log.info('Conversation exported', { path: filePath });
    } catch (error) {
      log.error('Failed to export conversation', error);
      this.setStatus('Export failed', 'error');
    }
  }

  /**
   * Handle /export command with format options.
   */
  private async handleExportCommand(args: string): Promise<void> {
    if (this.conversation.messages.length === 0) {
      this.showTemporaryStatus('No messages to export', 'info', 2000);
      return;
    }

    const format = args.toLowerCase().trim();

    switch (format) {
      case 'clipboard':
      case 'copy':
        await this.exportToClipboard();
        break;
      case 'json':
        await this.exportToJson();
        break;
      case 'md':
      case 'markdown':
      case '':
        await this.exportConversation();
        break;
      default:
        this.showTemporaryStatus('Unknown format. Use: /export [clipboard|json|markdown]', 'info', 3000);
    }
  }

  /**
   * Export conversation to clipboard as markdown.
   */
  private async exportToClipboard(): Promise<void> {
    const lines: string[] = [];
    lines.push(`# ${this.conversation.title}`);
    lines.push('');

    for (const msg of this.conversation.messages) {
      const role = msg.role === 'user' ? '**You**' : '**Claude**';
      lines.push(`### ${role}`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    await navigator.clipboard.writeText(lines.join('\n'));
    this.showTemporaryStatus('Copied to clipboard', 'success', 2000);
  }

  /**
   * Export conversation to JSON file.
   */
  private async exportToJson(): Promise<void> {
    const exportData = {
      id: this.conversation.id,
      title: this.conversation.title,
      createdAt: this.conversation.createdAt,
      exportedAt: Date.now(),
      model: this.plugin.settings.model,
      messages: this.conversation.messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        toolCalls: m.toolCalls,
      })),
    };

    const content = JSON.stringify(exportData, null, 2);

    const sanitizedTitle = this.conversation.title
      .replace(/[\\/:*?"<>|]/g, '-')
      .slice(0, 50);
    const filename = `Claude Chat - ${sanitizedTitle}.json`;

    const folderPath = 'Claude Exports';
    const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      await this.plugin.app.vault.createFolder(folderPath);
    }

    const filePath = `${folderPath}/${filename}`;

    try {
      const existingFile = this.plugin.app.vault.getAbstractFileByPath(filePath);
      if (existingFile) {
        await this.plugin.app.vault.modify(existingFile as import('obsidian').TFile, content);
      } else {
        await this.plugin.app.vault.create(filePath, content);
      }

      this.showTemporaryStatus(`Exported JSON to "${filename}"`, 'success');
    } catch (error) {
      log.error('Failed to export JSON', error);
      this.setStatus('Export failed', 'error');
    }
  }

  private async _clearMessages(): Promise<void> {
    log.info('Clearing messages', { conversationId: this.conversation.id });
    this.conversation.messages = [];
    this.conversation.sessionId = undefined;
    this.renderAllMessages();
    await this.saveConversation();
    this.showTemporaryStatus('Messages cleared', 'info', 2000);
  }

  // ============================================================
  // Public API methods for commands and external access
  // ============================================================

  /** Focus the chat input */
  focusInput(): void {
    this.inputEl?.focus();
  }

  /** Start a new conversation */
  async newConversation(): Promise<void> {
    await this._newConversation();
  }

  /** Clear all messages in current conversation */
  async clearMessages(): Promise<void> {
    await this._clearMessages();
  }

  /** Stop/abort the current response */
  stopResponse(): void {
    if (this.isProcessing) {
      this.handleStopClick();
    }
  }

  /** Copy the last assistant response to clipboard */
  async copyLastResponse(): Promise<void> {
    const lastAssistantMsg = [...this.conversation.messages]
      .reverse()
      .find(m => m.role === 'assistant');

    if (lastAssistantMsg) {
      await navigator.clipboard.writeText(lastAssistantMsg.content);
      new Notice('Copied to clipboard');
    } else {
      new Notice('No assistant response to copy');
    }
  }

  /** Toggle conversation history panel */
  async toggleHistory(): Promise<void> {
    await this._toggleHistory();
  }

  /** Toggle in-conversation search */
  toggleSearch(): void {
    this._toggleSearch();
  }

  private scrollToBottom(force = false): void {
    if (!this.messagesContainer) return;
    // Only auto-scroll if user hasn't scrolled up, or if forced
    if (!this.userScrolledUp || force) {
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
  }

  // ===== COMMAND AUTOCOMPLETE =====

  private updateAutocomplete(): void {
    const value = this.inputEl.value;

    // Only show autocomplete for slash commands at the start
    if (!value.startsWith('/') || value.includes(' ')) {
      this.hideAutocomplete();
      return;
    }

    const query = value.slice(1).toLowerCase();
    const allCommands = getCommandList();

    // Filter commands that match the query
    this.autocompleteCommands = allCommands.filter(cmd => {
      const cmdName = cmd.name.split(' ')[0].slice(1); // Remove / and get base command
      return cmdName.startsWith(query);
    });

    if (this.autocompleteCommands.length === 0) {
      this.hideAutocomplete();
      return;
    }

    this.showAutocomplete();
  }

  private showAutocomplete(): void {
    if (!this.autocompleteEl) {
      this.autocompleteEl = this.inputWrapper.createDiv('command-autocomplete');
    }

    this.autocompleteEl.empty();
    this.autocompleteIndex = 0;

    for (let i = 0; i < this.autocompleteCommands.length; i++) {
      const cmd = this.autocompleteCommands[i];
      const item = this.autocompleteEl.createDiv('command-autocomplete-item');
      if (i === 0) item.addClass('is-selected');

      const nameEl = item.createDiv('command-autocomplete-name');
      nameEl.setText(cmd.name);

      const descEl = item.createDiv('command-autocomplete-desc');
      descEl.setText(cmd.description);

      item.addEventListener('click', () => {
        this.autocompleteIndex = i;
        this.selectAutocompleteCommand();
      });

      item.addEventListener('mouseenter', () => {
        this.autocompleteIndex = i;
        this.updateAutocompleteSelection();
      });
    }
  }

  private hideAutocomplete(): void {
    if (this.autocompleteEl) {
      this.autocompleteEl.remove();
      this.autocompleteEl = null;
    }
    this.autocompleteCommands = [];
    this.autocompleteIndex = -1;
  }

  private updateAutocompleteSelection(): void {
    if (!this.autocompleteEl) return;

    const items = this.autocompleteEl.querySelectorAll('.command-autocomplete-item');
    items.forEach((item, i) => {
      item.toggleClass('is-selected', i === this.autocompleteIndex);
    });

    // Scroll selected item into view
    const selected = items[this.autocompleteIndex] as HTMLElement;
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }

  private selectAutocompleteCommand(): void {
    if (this.autocompleteIndex < 0 || this.autocompleteIndex >= this.autocompleteCommands.length) {
      this.hideAutocomplete();
      return;
    }

    const cmd = this.autocompleteCommands[this.autocompleteIndex];
    // Extract just the command name (e.g., "/export" from "/export [clipboard|json]")
    const cmdName = cmd.name.split(' ')[0];

    this.inputEl.value = cmdName + ' ';
    this.inputEl.focus();
    this.hideAutocomplete();

    // Trigger resize via module
    if (this.inputModule) {
      this.inputModule.resize();
    }
  }

  // ===== MOBILE SUPPORT =====

  /**
   * Check if running on mobile device.
   */
  private isMobile(): boolean {
    return document.body.classList.contains('is-mobile');
  }

  // ===== TAB MANAGEMENT =====

  /**
   * Initialize tabs from saved state or create default tab.
   */
  private initializeTabs(): void {
    // Load saved tabs from plugin data
    const savedTabs = this.plugin.settings.savedTabs as ChatTab[] | undefined;
    const savedActiveTabId = this.plugin.settings.activeTabId as string | undefined;

    if (savedTabs && savedTabs.length > 0) {
      this.tabs = savedTabs;
      this.activeTabId = savedActiveTabId || savedTabs[0].id;
    } else {
      // Create initial tab for current conversation
      const initialTab: ChatTab = {
        id: generateId(),
        conversationId: this.conversation?.id || '',
        label: this.conversation?.title || 'New Chat',
      };
      this.tabs = [initialTab];
      this.activeTabId = initialTab.id;
    }
    log.debug('Tabs initialized', { count: this.tabs.length, activeTabId: this.activeTabId });
  }

  /**
   * Switch to a different tab.
   */
  private async switchToTab(tabId: string): Promise<void> {
    if (tabId === this.activeTabId) return;

    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    log.info('Switching tab', { fromTabId: this.activeTabId, toTabId: tabId });

    // Save current conversation before switching
    await this.saveConversation();

    // Update active tab
    this.activeTabId = tabId;

    // Load the conversation for this tab
    const conversations = await this.plugin.conversationStore.list();
    const targetConversation = conversations.find(c => c.id === tab.conversationId);

    if (targetConversation) {
      this.conversation = targetConversation;
    } else {
      // Create new conversation if not found
      this.conversation = {
        id: tab.conversationId || generateId(),
        title: 'New Chat',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      tab.conversationId = this.conversation.id;
    }

    // Update UI
    this.renderAllMessages();
    this.updateTitle();
    this.updateTabBarVisibility();
    await this.saveTabState();
  }

  /**
   * Create a new tab with a fresh conversation.
   */
  private async createNewTab(): Promise<void> {
    log.info('Creating new tab');

    // Save current conversation
    await this.saveConversation();

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

    this.tabs.push(newTab);
    this.activeTabId = newTab.id;
    this.conversation = newConversation;

    // Update UI
    this.renderAllMessages();
    this.updateTitle();
    this.updateTabBarVisibility();
    await this.saveTabState();

    // Focus input
    this.inputEl.focus();
  }

  /**
   * Close a tab.
   */
  private async closeTab(tabId: string): Promise<void> {
    if (this.tabs.length <= 1) return; // Don't close last tab

    const tabIndex = this.tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;

    log.info('Closing tab', { tabId });

    // Remove tab
    this.tabs.splice(tabIndex, 1);

    // If we closed the active tab, switch to adjacent one
    if (tabId === this.activeTabId) {
      const newIndex = Math.min(tabIndex, this.tabs.length - 1);
      await this.switchToTab(this.tabs[newIndex].id);
    } else {
      this.updateTabBarVisibility();
      await this.saveTabState();
    }
  }

  /**
   * Save tab state to plugin settings.
   */
  private async saveTabState(): Promise<void> {
    // Update tab labels from current conversation
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (activeTab && this.conversation) {
      activeTab.label = this.conversation.title;
      activeTab.conversationId = this.conversation.id;
    }

    // Save to plugin settings (need to extend settings type)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.plugin.settings as any).savedTabs = this.tabs;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.plugin.settings as any).activeTabId = this.activeTabId;
    await this.plugin.saveSettings();
    log.debug('Tab state saved', { tabs: this.tabs.length, activeTabId: this.activeTabId });
  }

  /**
   * Update the active tab's label when conversation title changes.
   */
  private updateActiveTabLabel(): void {
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (activeTab && this.conversation) {
      activeTab.label = this.conversation.title;
      this.tabModule?.render();
    }
  }

  /**
   * Update tab bar visibility based on tab count and settings.
   */
  private updateTabBarVisibility(): void {
    // Only show tab bar if we have multiple tabs or user explicitly enabled
    const shouldShow = this.tabs.length > 1 || this.tabsEnabled;
    this.tabModule?.setVisible(shouldShow);
    this.tabModule?.render();
  }

  async onClose(): Promise<void> {
    log.info('Closing chat view');

    // Clean up extracted modules
    this.searchBarModule?.destroy();
    this.queueModule?.destroy();
    this.statusModule?.destroy();
    this.mobileModule?.destroy();
    this.tabModule?.destroy();
    this.messageModule?.destroy();
    this.inputModule?.destroy();
    this.historyModule?.destroy();

    // Save tabs and conversation before closing
    await this.saveTabState();
    await this.saveConversation();
  }
}
