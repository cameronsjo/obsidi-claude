import {
  ItemView,
  WorkspaceLeaf,
  MarkdownRenderer,
  MarkdownView,
  Component,
  setIcon,
  Notice,
} from 'obsidian';
import { PermissionModal } from './chatViewModals';
import { executeCommand, type ChatViewCommandContext } from './chatViewCommands';
import type ObsidiClaudePlugin from '../main';
import type { ChatMessage, ToolCallInfo, Conversation, MessageUsage, ChatTab } from './types';
import { generateId, calculateCost, calculateConversationUsage } from './types';
import type { AgentBackend, AgentCallbacks, AgentResult } from './backends';
import type { PermissionRequestContext, PermissionResponse } from './backends/sdkAgentBackend';
import { createLogger } from './logger';

const log = createLogger('ChatView');

// UI Configuration Constants
const SCROLL_THRESHOLD_PX = 100;
const MAX_TEXTAREA_HEIGHT_PX = 180;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const MAX_INPUT_HISTORY_SIZE = 50;

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
  private inputEl: HTMLTextAreaElement;
  private sendButton: HTMLButtonElement;
  private stopButton: HTMLButtonElement;
  private voiceButton: HTMLButtonElement;
  private statusEl: HTMLElement;
  private historyPanel: HTMLElement;
  private historyList: HTMLElement;
  private chatTitleEl: HTMLElement;
  private backendBadge: HTMLElement;
  private contextBadge: HTMLElement;
  private accountBadge: HTMLElement;
  private ephemeralBadge: HTMLElement;
  private tokenCounter: HTMLElement;
  private searchInput: HTMLInputElement;
  private searchContainer: HTMLElement;
  private imagePreviewContainer: HTMLElement;
  private pendingImages: Array<{ data: string; mimeType: string; filename?: string }> = [];

  // State
  private conversation: Conversation;
  private isProcessing = false;
  private messageElements: Map<string, HTMLElement> = new Map();
  private historyVisible = false;
  private searchVisible = false;
  private searchQuery = '';
  private searchMatches: string[] = []; // message IDs that match
  private currentSearchIndex = -1;
  private userScrolledUp = false;
  private historyFilterTag: string | null = null; // Filter history by tag
  private vaultRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private historyTagsBar: HTMLElement | null = null;
  private historySearchInput: HTMLInputElement | null = null;
  private historySearchQuery: string = '';
  private bulkSelectMode: boolean = false;
  private selectedConversations: Set<string> = new Set();
  private bulkActionsBar: HTMLElement | null = null;

  // Voice input state
  private isRecording = false;
  private speechRecognition: SpeechRecognition | null = null;

  // Input history for up/down arrow navigation
  private inputHistory: string[] = [];
  private inputHistoryIndex = -1;
  private inputDraft = ''; // Saves current input when navigating history

  // Debounce timer for input resize
  private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Track last sent note to avoid redundant context injection
  private lastSentNotePath: string | null = null;
  private lastSentNoteContent: string | null = null;

  // Message queue for queueing messages while processing
  private messageQueue: { content: string; timestamp: number }[] = [];
  private queueContainer: HTMLElement;
  private queueBadge: HTMLElement;

  // Tab management
  private tabs: ChatTab[] = [];
  private activeTabId: string | null = null;
  private tabBar: HTMLElement | null = null;
  private tabsEnabled = true; // Can be disabled via settings

  // Input wrapper for processing state styling
  private inputWrapper!: HTMLElement;

  // Scroll to bottom button
  private scrollToBottomBtn: HTMLElement | null = null;

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

    // Header
    const header = container.createDiv('chat-header');
    this.createHeader(header);

    // Tab bar (below header)
    this.tabBar = container.createDiv('chat-tab-bar');
    this.initializeTabs();
    this.renderTabBar();

    // History panel (hidden by default)
    this.historyPanel = container.createDiv('chat-history-panel');
    this.historyPanel.style.display = 'none';
    this.createHistoryPanel(this.historyPanel);

    // Search bar (hidden by default)
    this.searchContainer = container.createDiv('chat-search-bar');
    this.searchContainer.style.display = 'none';
    this.createSearchBar(this.searchContainer);

    // Message queue container (hidden by default)
    this.queueContainer = container.createDiv('chat-queue-container');
    this.queueContainer.style.display = 'none';
    this.createQueueUI(this.queueContainer);

    // Messages area
    this.messagesContainer = container.createDiv('chat-messages');
    this.setupScrollTracking();

    // Status indicator
    this.statusEl = container.createDiv('chat-status');
    this.statusEl.style.display = 'none';

    // Input area
    const inputArea = container.createDiv('chat-input-area');
    this.createInputArea(inputArea);

    // Mobile: Add floating action button for new conversation
    this.createMobileFAB(container);

    // Mobile: Setup touch gestures
    this.setupMobileTouchHandling(container);

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
        // Force Obsidian to refresh the vault
        this.plugin.app.vault.trigger('modify', null as unknown as import('obsidian').TFile);
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
        } else if (this.historyVisible) {
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
    // History toggle button
    const historyBtn = header.createEl('button', {
      cls: 'chat-action-btn chat-history-btn',
      attr: { 'aria-label': 'Conversation history' },
    });
    setIcon(historyBtn, 'history');
    historyBtn.onclick = () => this._toggleHistory();

    // Title (clickable to show history)
    this.chatTitleEl = header.createDiv('chat-title');
    this.chatTitleEl.setText('Claude Chat');
    this.chatTitleEl.onclick = () => this._toggleHistory();

    // Backend indicator badge
    this.backendBadge = header.createDiv('backend-badge');
    this.updateBackendBadge();

    // Account info badge (SDK only)
    this.accountBadge = header.createDiv('account-badge');
    this.accountBadge.style.display = 'none';

    // Ephemeral mode badge
    this.ephemeralBadge = header.createDiv('ephemeral-badge');
    this.ephemeralBadge.setText('🔒');
    this.ephemeralBadge.setAttribute('aria-label', 'Ephemeral mode - sessions not saved');
    this.updateEphemeralBadge();

    // Active note context badge
    this.contextBadge = header.createDiv('context-badge');
    this.contextBadge.setAttribute('aria-label', 'Active note will be included as context');
    this.updateContextBadge();

    const actionsEl = header.createDiv('chat-actions');

    // Search button
    const searchBtn = actionsEl.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'Search messages' },
    });
    setIcon(searchBtn, 'search');
    searchBtn.onclick = () => this._toggleSearch();

    // New conversation button
    const newBtn = actionsEl.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'New conversation' },
    });
    setIcon(newBtn, 'plus');
    newBtn.onclick = () => this._newConversation();

    // Export button
    const exportBtn = actionsEl.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'Export as note' },
    });
    setIcon(exportBtn, 'file-down');
    exportBtn.onclick = () => this.exportConversation();

    // Clear button
    const clearBtn = actionsEl.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'Clear messages' },
    });
    setIcon(clearBtn, 'trash-2');
    clearBtn.onclick = () => this._clearMessages();
  }

  private createHistoryPanel(panel: HTMLElement): void {
    const header = panel.createDiv('history-header');
    header.createEl('h4', { text: 'Conversations' });

    const headerActions = header.createDiv('history-header-actions');

    // Bulk select toggle
    const bulkSelectBtn = headerActions.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'Select multiple' },
    });
    setIcon(bulkSelectBtn, 'list-checks');
    bulkSelectBtn.onclick = () => this.toggleBulkSelectMode();

    const closeBtn = headerActions.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'Close history' },
    });
    setIcon(closeBtn, 'x');
    closeBtn.onclick = () => this._toggleHistory();

    // Bulk actions bar (hidden by default)
    this.bulkActionsBar = panel.createDiv('history-bulk-actions');
    this.bulkActionsBar.style.display = 'none';
    this.createBulkActionsBar(this.bulkActionsBar);

    // Search bar for conversations
    const searchBar = panel.createDiv('history-search-bar');
    this.historySearchInput = searchBar.createEl('input', {
      cls: 'history-search-input',
      attr: {
        type: 'text',
        placeholder: 'Search conversations...',
      },
    });
    this.historySearchInput.addEventListener('input', () => {
      this.historySearchQuery = this.historySearchInput?.value || '';
      this.refreshHistoryList();
    });

    // Tag filter bar
    this.historyTagsBar = panel.createDiv('history-tags-bar');

    this.historyList = panel.createDiv('history-list');
  }

  private createBulkActionsBar(container: HTMLElement): void {
    const selectAllBtn = container.createEl('button', {
      cls: 'history-bulk-btn',
      text: 'Select All',
    });
    selectAllBtn.onclick = () => this.selectAllConversations();

    const deselectAllBtn = container.createEl('button', {
      cls: 'history-bulk-btn',
      text: 'Deselect All',
    });
    deselectAllBtn.onclick = () => this.deselectAllConversations();

    const deleteBtn = container.createEl('button', {
      cls: 'history-bulk-btn history-bulk-delete',
      text: 'Delete Selected',
    });
    deleteBtn.onclick = () => this.deleteSelectedConversations();

    const countEl = container.createSpan('history-bulk-count');
    countEl.setText('0 selected');
  }

  private toggleBulkSelectMode(): void {
    this.bulkSelectMode = !this.bulkSelectMode;
    this.selectedConversations.clear();
    if (this.bulkActionsBar) {
      this.bulkActionsBar.style.display = this.bulkSelectMode ? 'flex' : 'none';
    }
    this.updateBulkCount();
    this.refreshHistoryList();
  }

  private selectAllConversations(): void {
    const items = this.historyList.querySelectorAll('.history-item');
    items.forEach((item) => {
      const id = (item as HTMLElement).dataset.conversationId;
      if (id) {
        this.selectedConversations.add(id);
        item.addClass('history-item-selected');
        const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
        if (checkbox) checkbox.checked = true;
      }
    });
    this.updateBulkCount();
  }

  private deselectAllConversations(): void {
    this.selectedConversations.clear();
    const items = this.historyList.querySelectorAll('.history-item');
    items.forEach((item) => {
      item.removeClass('history-item-selected');
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (checkbox) checkbox.checked = false;
    });
    this.updateBulkCount();
  }

  private async deleteSelectedConversations(): Promise<void> {
    if (this.selectedConversations.size === 0) return;

    const count = this.selectedConversations.size;
    const confirmDelete = confirm(`Delete ${count} conversation${count > 1 ? 's' : ''}? This cannot be undone.`);
    if (!confirmDelete) return;

    for (const id of this.selectedConversations) {
      await this.plugin.storage.deleteConversation(id);
    }

    this.selectedConversations.clear();
    this.showTemporaryStatus(`Deleted ${count} conversation${count > 1 ? 's' : ''}`, 'success', 2000);
    await this.refreshHistoryList();
    this.updateBulkCount();

    // If current conversation was deleted, create new one
    const currentId = this.conversation.id;
    const conversations = await this.plugin.storage.listConversations();
    if (!conversations.find(c => c.id === currentId)) {
      this.conversation = this.createNewConversation();
      this.renderConversation();
    }
  }

  private updateBulkCount(): void {
    const countEl = this.bulkActionsBar?.querySelector('.history-bulk-count');
    if (countEl) {
      countEl.textContent = `${this.selectedConversations.size} selected`;
    }
  }

  private getDateGroup(timestamp: number): string {
    const now = new Date();
    const date = new Date(timestamp);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);
    const monthAgo = new Date(today.getTime() - 30 * 86400000);

    if (date >= today) return 'Today';
    if (date >= yesterday) return 'Yesterday';
    if (date >= weekAgo) return 'This Week';
    if (date >= monthAgo) return 'This Month';
    return 'Older';
  }

  private async refreshTagsBar(): Promise<void> {
    if (!this.historyTagsBar) return;
    this.historyTagsBar.empty();

    const allTags = await this.plugin.storage.getAllTags();
    if (allTags.length === 0) return;

    // "All" button
    const allBtn = this.historyTagsBar.createSpan({
      cls: `history-filter-tag ${this.historyFilterTag === null ? 'filter-tag-active' : ''}`,
    });
    allBtn.setText('All');
    allBtn.onclick = () => this.filterHistoryByTag(null);

    // Tag buttons
    for (const tag of allTags) {
      const tagBtn = this.historyTagsBar.createSpan({
        cls: `history-filter-tag ${this.historyFilterTag === tag ? 'filter-tag-active' : ''}`,
      });
      tagBtn.setText(tag);
      tagBtn.onclick = () => this.filterHistoryByTag(tag);
    }
  }

  private async filterHistoryByTag(tag: string | null): Promise<void> {
    this.historyFilterTag = tag;
    await this.refreshTagsBar();
    await this.refreshHistoryList();
  }

  private async _toggleHistory(): Promise<void> {
    this.historyVisible = !this.historyVisible;
    this.historyPanel.style.display = this.historyVisible ? 'block' : 'none';

    if (this.historyVisible) {
      await this.refreshHistoryList();
    }
  }

  private createSearchBar(container: HTMLElement): void {
    const inputWrapper = container.createDiv('search-input-wrapper');

    this.searchInput = inputWrapper.createEl('input', {
      cls: 'search-input',
      attr: {
        type: 'text',
        placeholder: 'Search messages...',
      },
    });

    this.searchInput.addEventListener('input', () => {
      this.performSearch(this.searchInput.value);
    });

    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          this.navigateSearch(-1);
        } else {
          this.navigateSearch(1);
        }
      } else if (e.key === 'Escape') {
        this._toggleSearch();
      }
    });

    // Navigation buttons
    const navButtons = container.createDiv('search-nav-buttons');

    const prevBtn = navButtons.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'Previous match' },
    });
    setIcon(prevBtn, 'chevron-up');
    prevBtn.onclick = () => this.navigateSearch(-1);

    const nextBtn = navButtons.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'Next match' },
    });
    setIcon(nextBtn, 'chevron-down');
    nextBtn.onclick = () => this.navigateSearch(1);

    // Match count
    const countEl = container.createSpan('search-match-count');
    countEl.dataset.searchCount = '';

    // Close button
    const closeBtn = navButtons.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'Close search' },
    });
    setIcon(closeBtn, 'x');
    closeBtn.onclick = () => this._toggleSearch();
  }

  private _toggleSearch(): void {
    this.searchVisible = !this.searchVisible;
    this.searchContainer.style.display = this.searchVisible ? 'flex' : 'none';

    if (this.searchVisible) {
      this.searchInput.focus();
      this.searchInput.select();
    } else {
      this.clearSearchHighlights();
      this.searchQuery = '';
      this.searchMatches = [];
      this.currentSearchIndex = -1;
      this.searchInput.value = '';
    }
  }

  private createQueueUI(container: HTMLElement): void {
    const headerDiv = container.createDiv('queue-header');

    const titleDiv = headerDiv.createDiv('queue-title');
    titleDiv.createSpan({ text: 'Message Queue' });
    this.queueBadge = titleDiv.createSpan({ cls: 'queue-badge' });

    const actionsDiv = headerDiv.createDiv('queue-actions');

    const clearBtn = actionsDiv.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'Clear queue' },
    });
    setIcon(clearBtn, 'trash-2');
    clearBtn.onclick = () => this.clearQueue();

    // Queue list container
    container.createDiv('queue-list');
  }

  private updateQueueUI(): void {
    const queueCount = this.messageQueue.length;

    // Show/hide queue container
    this.queueContainer.style.display = queueCount > 0 ? 'block' : 'none';

    // Update badge
    if (this.queueBadge) {
      this.queueBadge.setText(String(queueCount));
    }

    // Update list
    const listEl = this.queueContainer.querySelector('.queue-list') as HTMLElement;
    if (!listEl) return;

    listEl.empty();

    this.messageQueue.forEach((item, index) => {
      const itemEl = listEl.createDiv('queue-item');

      const contentDiv = itemEl.createDiv('queue-item-content');

      // Show position number
      const posSpan = contentDiv.createSpan({ text: `${index + 1}. `, cls: 'queue-item-pos' });

      // Show truncated message
      const preview = item.content.length > 50 ? item.content.slice(0, 50) + '...' : item.content;
      contentDiv.createSpan({ text: preview });

      // Remove button
      const removeBtn = itemEl.createEl('button', {
        cls: 'queue-remove-btn',
        attr: { 'aria-label': 'Remove from queue' },
      });
      setIcon(removeBtn, 'x');
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        this.removeFromQueue(index);
      };
    });
  }

  private addToQueue(content: string): void {
    this.messageQueue.push({
      content,
      timestamp: Date.now(),
    });
    this.updateQueueUI();
    this.showTemporaryStatus(`Message queued (${this.messageQueue.length} in queue)`, 'info', 2000);
    log.debug('Message added to queue', { queueLength: this.messageQueue.length });
  }

  private removeFromQueue(index: number): void {
    if (index >= 0 && index < this.messageQueue.length) {
      this.messageQueue.splice(index, 1);
      this.updateQueueUI();
      log.debug('Message removed from queue', { index, queueLength: this.messageQueue.length });
    }
  }

  private clearQueue(): void {
    this.messageQueue = [];
    this.updateQueueUI();
    this.showTemporaryStatus('Queue cleared', 'info', 2000);
    log.debug('Queue cleared');
  }

  private async processNextInQueue(): Promise<void> {
    if (this.messageQueue.length === 0 || this.isProcessing) {
      return;
    }

    const nextMessage = this.messageQueue.shift();
    this.updateQueueUI();

    if (nextMessage) {
      log.info('Processing next message from queue', { queueRemaining: this.messageQueue.length });
      // Set the input value and trigger send
      this.inputEl.value = nextMessage.content;
      await this.sendMessage();
    }
  }

  private performSearch(query: string): void {
    this.searchQuery = query.toLowerCase().trim();
    this.clearSearchHighlights();
    this.searchMatches = [];
    this.currentSearchIndex = -1;

    if (!this.searchQuery) {
      this.updateSearchCount();
      return;
    }

    // Find matching messages
    for (const msg of this.conversation.messages) {
      if (msg.content?.toLowerCase().includes(this.searchQuery)) {
        this.searchMatches.push(msg.id);
        const msgEl = this.messageElements.get(msg.id);
        if (msgEl) {
          msgEl.addClass('search-match');
        }
      }
    }

    this.updateSearchCount();

    // Navigate to first match
    if (this.searchMatches.length > 0) {
      this.navigateSearch(1);
    }
  }

  private navigateSearch(direction: number): void {
    if (this.searchMatches.length === 0) return;

    // Remove current highlight
    if (this.currentSearchIndex >= 0) {
      const currentId = this.searchMatches[this.currentSearchIndex];
      const currentEl = this.messageElements.get(currentId);
      if (currentEl) {
        currentEl.removeClass('search-current');
      }
    }

    // Move to next/previous
    this.currentSearchIndex += direction;
    if (this.currentSearchIndex >= this.searchMatches.length) {
      this.currentSearchIndex = 0;
    } else if (this.currentSearchIndex < 0) {
      this.currentSearchIndex = this.searchMatches.length - 1;
    }

    // Highlight and scroll to current match
    const targetId = this.searchMatches[this.currentSearchIndex];
    const targetEl = this.messageElements.get(targetId);
    if (targetEl) {
      targetEl.addClass('search-current');
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    this.updateSearchCount();
  }

  private updateSearchCount(): void {
    const countEl = this.searchContainer.querySelector('.search-match-count');
    if (!countEl) return;

    if (this.searchMatches.length === 0) {
      countEl.textContent = this.searchQuery ? 'No matches' : '';
    } else {
      countEl.textContent = `${this.currentSearchIndex + 1}/${this.searchMatches.length}`;
    }
  }

  private clearSearchHighlights(): void {
    for (const msgEl of this.messageElements.values()) {
      msgEl.removeClass('search-match');
      msgEl.removeClass('search-current');
    }
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

  private async refreshHistoryList(): Promise<void> {
    if (!this.historyList) return;
    this.historyList.empty();

    // Refresh tags bar first
    await this.refreshTagsBar();

    let conversations = await this.plugin.storage.listConversations();

    // Filter by tag if one is selected
    if (this.historyFilterTag) {
      conversations = conversations.filter(c =>
        c.tags && c.tags.includes(this.historyFilterTag!)
      );
    }

    // Filter by search query (searches title and preview)
    if (this.historySearchQuery) {
      const query = this.historySearchQuery.toLowerCase();
      conversations = conversations.filter(c =>
        c.title.toLowerCase().includes(query) ||
        (c.preview && c.preview.toLowerCase().includes(query))
      );
    }

    if (conversations.length === 0) {
      let emptyMsg = 'No conversations yet';
      if (this.historySearchQuery) {
        emptyMsg = `No conversations matching "${this.historySearchQuery}"`;
      } else if (this.historyFilterTag) {
        emptyMsg = `No conversations with tag "${this.historyFilterTag}"`;
      }
      this.historyList.createDiv('history-empty').setText(emptyMsg);
      return;
    }

    // Group conversations by date (pinned first, then by date groups)
    const pinned = conversations.filter(c => c.pinned);
    const unpinned = conversations.filter(c => !c.pinned);

    // Group unpinned by date
    const groups = new Map<string, typeof conversations>();
    for (const conv of unpinned) {
      const group = this.getDateGroup(conv.updatedAt);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(conv);
    }

    // Render pinned section
    if (pinned.length > 0) {
      this.historyList.createDiv('history-group-header').setText('📌 Pinned');
      for (const conv of pinned) {
        this.renderHistoryItem(conv);
      }
    }

    // Render date groups in order
    const groupOrder = ['Today', 'Yesterday', 'This Week', 'This Month', 'Older'];
    for (const groupName of groupOrder) {
      const groupConvs = groups.get(groupName);
      if (groupConvs && groupConvs.length > 0) {
        this.historyList.createDiv('history-group-header').setText(groupName);
        for (const conv of groupConvs) {
          this.renderHistoryItem(conv);
        }
      }
    }
  }

  private renderHistoryItem(conv: {
    id: string;
    title: string;
    messageCount: number;
    createdAt: number;
    updatedAt: number;
    tags?: string[];
    pinned?: boolean;
    preview?: string;
  }): void {
    const item = this.historyList.createDiv('history-item');
    item.dataset.conversationId = conv.id;

    if (conv.id === this.conversation.id) {
      item.addClass('history-item-active');
    }
    if (conv.pinned) {
      item.addClass('history-item-pinned');
    }
    if (this.selectedConversations.has(conv.id)) {
      item.addClass('history-item-selected');
    }

    // Checkbox for bulk select mode
    if (this.bulkSelectMode) {
      const checkbox = item.createEl('input', {
        cls: 'history-item-checkbox',
        attr: { type: 'checkbox' },
      });
      checkbox.checked = this.selectedConversations.has(conv.id);
      checkbox.onclick = (e) => {
        e.stopPropagation();
        if (checkbox.checked) {
          this.selectedConversations.add(conv.id);
          item.addClass('history-item-selected');
        } else {
          this.selectedConversations.delete(conv.id);
          item.removeClass('history-item-selected');
        }
        this.updateBulkCount();
      };
    }

    const info = item.createDiv('history-item-info');

    // Title row with pin indicator
    const titleRow = info.createDiv('history-item-title-row');
    if (conv.pinned) {
      const pinIcon = titleRow.createSpan('history-pin-indicator');
      setIcon(pinIcon, 'pin');
    }
    const title = titleRow.createSpan('history-item-title');
    title.setText(conv.title || 'Untitled');

    // Preview (truncated last message)
    if (conv.preview) {
      const previewEl = info.createDiv('history-item-preview');
      previewEl.setText(conv.preview);
    }

    // Tags row (if any)
    if (conv.tags && conv.tags.length > 0) {
      const tagsRow = info.createDiv('history-item-tags');
      for (const tag of conv.tags.slice(0, 3)) {
        const tagEl = tagsRow.createSpan('history-tag');
        tagEl.setText(tag);
      }
      if (conv.tags.length > 3) {
        tagsRow.createSpan('history-tag-more').setText(`+${conv.tags.length - 3}`);
      }
    }

    const meta = info.createDiv('history-item-meta');
    const date = new Date(conv.updatedAt);
    const dateStr = this.formatRelativeDate(date);
    meta.setText(`${conv.messageCount} messages · ${dateStr}`);

    // Click to load (unless in bulk select mode)
    item.onclick = () => {
      if (this.bulkSelectMode) {
        const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          if (checkbox.checked) {
            this.selectedConversations.add(conv.id);
            item.addClass('history-item-selected');
          } else {
            this.selectedConversations.delete(conv.id);
            item.removeClass('history-item-selected');
          }
          this.updateBulkCount();
        }
      } else {
        this.loadConversationById(conv.id);
      }
    };

    // Actions (hidden in bulk select mode)
    const actions = item.createDiv('history-item-actions');
    if (this.bulkSelectMode) {
      actions.style.display = 'none';
    }

    // Pin/unpin button
    const pinBtn = actions.createEl('button', {
      cls: 'history-action-btn',
      attr: { 'aria-label': conv.pinned ? 'Unpin conversation' : 'Pin conversation' },
    });
    setIcon(pinBtn, conv.pinned ? 'pin-off' : 'pin');
    pinBtn.onclick = (e) => {
      e.stopPropagation();
      this.togglePinConversation(conv.id);
    };

    // Rename button
    const renameBtn = actions.createEl('button', {
      cls: 'history-action-btn',
      attr: { 'aria-label': 'Rename conversation' },
    });
    setIcon(renameBtn, 'pencil');
    renameBtn.onclick = (e) => {
      e.stopPropagation();
      this.promptRenameConversation(conv.id, conv.title);
    };

    // Tag button
    const tagBtn = actions.createEl('button', {
      cls: 'history-action-btn',
      attr: { 'aria-label': 'Manage tags' },
    });
    setIcon(tagBtn, 'tag');
    tagBtn.onclick = (e) => {
      e.stopPropagation();
      this.promptManageTags(conv.id, conv.tags || []);
    };

    // Continue button (if has session)
    const continueBtn = actions.createEl('button', {
      cls: 'history-action-btn',
      attr: { 'aria-label': 'Continue conversation' },
    });
    setIcon(continueBtn, 'play');
    continueBtn.onclick = (e) => {
      e.stopPropagation();
      this.continueConversation(conv.id);
    };

    // Duplicate button
    const duplicateBtn = actions.createEl('button', {
      cls: 'history-action-btn',
      attr: { 'aria-label': 'Duplicate conversation' },
    });
    setIcon(duplicateBtn, 'copy-plus');
    duplicateBtn.onclick = (e) => {
      e.stopPropagation();
      this.duplicateConversation(conv.id);
    };

    // Delete button
    const deleteBtn = actions.createEl('button', {
      cls: 'history-action-btn history-delete-btn',
      attr: { 'aria-label': 'Delete conversation' },
    });
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      this.deleteConversation(conv.id);
    };
  }

  private formatRelativeDate(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  }

  private async togglePinConversation(id: string): Promise<void> {
    const isPinned = await this.plugin.storage.togglePin(id);
    this.showTemporaryStatus(isPinned ? 'Conversation pinned' : 'Conversation unpinned', 'success', 1500);
    await this.refreshHistoryList();

    // Update current conversation if it's the one being pinned
    if (this.conversation.id === id) {
      this.conversation.pinned = isPinned;
    }
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
        await this.refreshHistoryList();

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
      await this.refreshHistoryList();
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
      await this.refreshHistoryList();
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

    await this.refreshHistoryList();
  }

  private updateTitle(): void {
    if (!this.chatTitleEl) return;
    const title = this.conversation.title || 'New Conversation';
    this.chatTitleEl.setText(title.length > 30 ? title.slice(0, 30) + '...' : title);
    // Also update the active tab label
    this.updateActiveTabLabel();
  }

  private createInputArea(inputArea: HTMLElement): void {
    // Wrapper for input and buttons
    this.inputWrapper = inputArea.createDiv('chat-input-wrapper');

    // Textarea
    this.inputEl = this.inputWrapper.createEl('textarea', {
      cls: 'chat-input',
      attr: {
        placeholder: 'Ask Claude anything...',
      },
    });

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      } else if (e.key === 'ArrowUp' && this.inputEl.selectionStart === 0) {
        // Navigate to previous message when cursor is at start
        e.preventDefault();
        this.navigateInputHistory(-1);
      } else if (e.key === 'ArrowDown' && this.inputEl.selectionStart === this.inputEl.value.length) {
        // Navigate to next message when cursor is at end
        e.preventDefault();
        this.navigateInputHistory(1);
      }
    });

    // Auto-resize textarea (debounced with RAF for smooth performance)
    this.inputEl.addEventListener('input', () => {
      if (this.resizeDebounceTimer) {
        cancelAnimationFrame(this.resizeDebounceTimer);
      }
      this.resizeDebounceTimer = requestAnimationFrame(() => {
        this.inputEl.style.height = 'auto';
        this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, MAX_TEXTAREA_HEIGHT_PX) + 'px';
      });
    });

    // Handle image paste
    this.inputEl.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            this.handleImageFile(file);
          }
          break;
        }
      }
    });

    // Handle drag and drop
    this.inputWrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.inputWrapper.addClass('drag-over');
    });

    this.inputWrapper.addEventListener('dragleave', () => {
      this.inputWrapper.removeClass('drag-over');
    });

    this.inputWrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      this.inputWrapper.removeClass('drag-over');

      const files = e.dataTransfer?.files;
      if (!files) return;

      for (const file of files) {
        if (file.type.startsWith('image/')) {
          this.handleImageFile(file);
        }
      }
    });

    // Image preview container (above input)
    this.imagePreviewContainer = this.inputWrapper.createDiv('chat-image-preview');
    this.imagePreviewContainer.style.display = 'none';

    // Button container
    const buttonArea = this.inputWrapper.createDiv('chat-buttons');

    // Left side: hint and token counter
    const leftArea = buttonArea.createDiv('chat-buttons-left');

    // Keyboard hint
    const hintEl = leftArea.createSpan('chat-input-hint');
    hintEl.setText('Enter to send · Queue when busy · /help');

    // Token counter
    this.tokenCounter = leftArea.createSpan('chat-token-counter');
    this.updateTokenCounter();

    // Stop button (hidden by default)
    this.stopButton = buttonArea.createEl('button', {
      cls: 'chat-stop-btn',
    });
    setIcon(this.stopButton, 'circle-stop');
    this.stopButton.createSpan({ text: 'Stop' });
    this.stopButton.style.display = 'none';
    this.stopButton.onclick = () => this.stopGeneration();

    // Voice input button (if Web Speech API available)
    this.voiceButton = buttonArea.createEl('button', {
      cls: 'chat-voice-btn',
      attr: { 'aria-label': 'Voice input' },
    });
    setIcon(this.voiceButton, 'mic');
    this.voiceButton.onclick = () => this.toggleVoiceInput();
    // Hide if Speech API not available
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      this.voiceButton.style.display = 'none';
    }

    // Send button
    this.sendButton = buttonArea.createEl('button', {
      cls: 'chat-send-btn mod-cta',
    });
    setIcon(this.sendButton, 'send');
    this.sendButton.createSpan({ text: 'Send' });
    this.sendButton.onclick = () => this.sendMessage();
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

    // Auto-generate title from first user message if still default
    if (
      this.conversation.title === 'New Conversation' &&
      this.conversation.messages.length > 0
    ) {
      const firstUserMsg = this.conversation.messages.find((m) => m.role === 'user');
      if (firstUserMsg) {
        this.conversation.title = this.plugin.storage.generateTitle(firstUserMsg.content);
        this.updateTitle();
      }
    }

    await this.plugin.storage.saveConversation(this.conversation);
  }

  private renderAllMessages(): void {
    if (!this.messagesContainer) return;
    this.messagesContainer.empty();
    this.messageElements.clear();

    for (const msg of this.conversation.messages) {
      this.renderMessage(msg);
    }
    // Force scroll when rendering all messages (loading conversation)
    this.userScrolledUp = false;
    this.scrollToBottom(true);

    // Update token counter
    this.updateTokenCounter();
  }

  private renderMessage(msg: ChatMessage): HTMLElement | null {
    if (!this.messagesContainer) return null;
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

    // Re-render the message to update button states
    const msgEl = this.messageElements.get(messageId);
    if (msgEl) {
      // Update bookmark class on message wrapper
      msgEl.toggleClass('message-bookmarked', msg.bookmarked);

      const actionsDiv = msgEl.querySelector('.message-actions') as HTMLElement;
      if (actionsDiv) {
        actionsDiv.empty();
        this.createMessageActions(actionsDiv, msg);
      }
    }

    await this.saveConversation();
  }

  private async toggleReaction(messageId: string, reaction: 'up' | 'down'): Promise<void> {
    const msg = this.conversation.messages.find(m => m.id === messageId);
    if (!msg) return;

    // Toggle: if same reaction, clear it; otherwise set new reaction
    msg.reaction = msg.reaction === reaction ? null : reaction;

    // Re-render the message to update button states
    const msgEl = this.messageElements.get(messageId);
    if (msgEl) {
      const actionsDiv = msgEl.querySelector('.message-actions') as HTMLElement;
      if (actionsDiv) {
        actionsDiv.empty();
        this.createMessageActions(actionsDiv, msg);
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

  private updateBackendBadge(): void {
    if (!this.backendBadge) return;

    const backend = this.getBackend();
    const type = backend.type.toUpperCase();

    this.backendBadge.empty();
    this.backendBadge.setText(type);
    this.backendBadge.className = `backend-badge backend-${backend.type}`;
    this.backendBadge.setAttribute('aria-label',
      backend.type === 'sdk'
        ? 'Using Claude Code SDK (full features)'
        : 'Using direct API (mobile compatible)'
    );
  }

  private updateEphemeralBadge(): void {
    if (!this.ephemeralBadge) return;
    this.ephemeralBadge.style.display = this.plugin.settings.ephemeralMode ? 'inline-flex' : 'none';
  }

  private updateAccountBadge(): void {
    if (!this.accountBadge) return;

    const backend = this.getBackend();
    if (backend.type !== 'sdk' || !('getAccountInfo' in backend)) {
      this.accountBadge.style.display = 'none';
      return;
    }

    // Type assertion for SDK-specific method
    const sdkBackend = backend as { getAccountInfo(): { email?: string; organization?: string; subscriptionType?: string } | null };
    const accountInfo = sdkBackend.getAccountInfo();

    if (!accountInfo) {
      this.accountBadge.style.display = 'none';
      return;
    }

    // Display subscription type or "Pro" indicator
    const displayText = accountInfo.subscriptionType || 'Pro';
    this.accountBadge.empty();
    this.accountBadge.setText(displayText);
    this.accountBadge.className = 'account-badge';
    this.accountBadge.style.display = 'inline-flex';

    // Build tooltip with available info
    const tooltipParts: string[] = [];
    if (accountInfo.email) {
      tooltipParts.push(`Account: ${accountInfo.email}`);
    }
    if (accountInfo.organization) {
      tooltipParts.push(`Org: ${accountInfo.organization}`);
    }
    if (accountInfo.subscriptionType) {
      tooltipParts.push(`Plan: ${accountInfo.subscriptionType}`);
    }
    this.accountBadge.setAttribute('aria-label', tooltipParts.join(' | ') || 'Authenticated');
  }

  private updateContextBadge(): void {
    if (!this.contextBadge) return;

    const enabled = this.plugin.settings.activeNoteContext;
    const activeFile = this.plugin.app.workspace.getActiveFile();
    const hasActiveNote = activeFile && activeFile.extension === 'md';

    this.contextBadge.empty();

    if (enabled && hasActiveNote) {
      // Show badge with file icon and truncated name
      const fileName = activeFile.basename;
      const displayName = fileName.length > 15 ? fileName.slice(0, 12) + '...' : fileName;
      setIcon(this.contextBadge, 'file-text');
      this.contextBadge.createSpan({ text: displayName });
      this.contextBadge.style.display = 'flex';
      this.contextBadge.setAttribute('aria-label', `Context: ${activeFile.path}`);
    } else {
      this.contextBadge.style.display = 'none';
    }
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

  private updateTokenCounter(): void {
    if (!this.tokenCounter) return;

    const tokens = this.estimateTokens();
    if (tokens === 0) {
      this.tokenCounter.style.display = 'none';
      return;
    }

    // Format with K suffix for thousands
    const formatted = tokens >= 1000
      ? `${(tokens / 1000).toFixed(1)}K`
      : tokens.toString();

    this.tokenCounter.setText(`~${formatted} tokens`);
    this.tokenCounter.style.display = 'inline';
    this.tokenCounter.setAttribute('aria-label', `Estimated ${tokens.toLocaleString()} tokens in conversation`);
  }

  private setProcessing(processing: boolean): void {
    this.isProcessing = processing;
    if (!this.sendButton || !this.stopButton || !this.inputEl) return;
    this.sendButton.style.display = processing ? 'none' : 'inline-flex';
    this.stopButton.style.display = processing ? 'inline-flex' : 'none';
    // Keep input enabled during processing to allow message queuing
    // The sendMessage method handles queuing when isProcessing is true

    // Add/remove processing class for visual feedback
    if (this.inputWrapper) {
      this.inputWrapper.toggleClass('is-processing', processing);
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
      searchInput: this.searchInput,
      messagesContainer: this.messagesContainer,

      getMessageQueue: () => this.messageQueue,
      isSearchVisible: () => this.searchVisible,

      showTemporaryStatus: (msg, type, duration) => this.showTemporaryStatus(msg, type, duration),
      setStatus: (msg, type) => this.setStatus(msg, type),
      renderAllMessages: () => this.renderAllMessages(),
      scrollToBottom: (force) => this.scrollToBottom(force),

      clearMessages: () => this._clearMessages(),
      newConversation: () => this._newConversation(),
      toggleSearch: () => this._toggleSearch(),
      clearQueue: () => this.clearQueue(),
      performSearch: (query) => this.performSearch(query),
      addTagToConversation: (tag) => this.addTagToConversation(tag),
      removeTagFromConversation: (tag) => this.removeTagFromConversation(tag),
      saveConversation: () => this.saveConversation(),
      exportConversation: () => this.exportConversation(),
      exportToClipboard: () => this.exportToClipboard(),
      exportToJson: () => this.exportToJson(),

      resizeInput: () => {
        this.inputEl.style.height = 'auto';
        this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, MAX_TEXTAREA_HEIGHT_PX) + 'px';
      },
      focusInput: () => this.inputEl.focus(),
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

  private navigateInputHistory(direction: number): void {
    if (this.inputHistory.length === 0) return;

    // Save current input as draft when starting to navigate
    if (this.inputHistoryIndex === -1) {
      this.inputDraft = this.inputEl.value;
    }

    // Calculate new index
    const newIndex = this.inputHistoryIndex + direction;

    if (newIndex < -1) {
      // Already at oldest, do nothing
      return;
    } else if (newIndex >= this.inputHistory.length) {
      // Past newest, do nothing
      return;
    } else if (newIndex === -1) {
      // Back to draft
      this.inputHistoryIndex = -1;
      this.inputEl.value = this.inputDraft;
    } else {
      // Navigate to history entry (newest is at end of array)
      this.inputHistoryIndex = newIndex;
      const historyIndex = this.inputHistory.length - 1 - newIndex;
      this.inputEl.value = this.inputHistory[historyIndex];
    }

    // Move cursor to end
    this.inputEl.selectionStart = this.inputEl.value.length;
    this.inputEl.selectionEnd = this.inputEl.value.length;

    // Trigger resize
    this.inputEl.style.height = 'auto';
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, MAX_TEXTAREA_HEIGHT_PX) + 'px';
  }

  /**
   * Handle an image file (from paste or drop)
   */
  private async handleImageFile(file: File): Promise<void> {
    const maxSize = 10 * 1024 * 1024; // 10MB limit
    if (file.size > maxSize) {
      new Notice('Image too large (max 10MB)');
      return;
    }

    try {
      const data = await this.fileToBase64(file);
      const mimeType = file.type;
      const filename = file.name;

      this.pendingImages.push({ data, mimeType, filename });
      this.updateImagePreview();

      log.info('Image added', { filename, mimeType, size: file.size });
    } catch (error) {
      log.error('Failed to process image', error);
      new Notice('Failed to process image');
    }
  }

  /**
   * Convert a file to base64
   */
  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data URL prefix (e.g., "data:image/png;base64,")
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Update the image preview display
   */
  private updateImagePreview(): void {
    this.imagePreviewContainer.empty();

    if (this.pendingImages.length === 0) {
      this.imagePreviewContainer.style.display = 'none';
      return;
    }

    this.imagePreviewContainer.style.display = 'flex';

    for (let i = 0; i < this.pendingImages.length; i++) {
      const img = this.pendingImages[i];
      const wrapper = this.imagePreviewContainer.createDiv('chat-image-thumb');

      const imgEl = wrapper.createEl('img', {
        attr: {
          src: `data:${img.mimeType};base64,${img.data}`,
          alt: img.filename || 'Image',
        },
      });

      // Remove button
      const removeBtn = wrapper.createDiv('chat-image-remove');
      removeBtn.setText('×');
      removeBtn.onclick = () => {
        this.pendingImages.splice(i, 1);
        this.updateImagePreview();
      };
    }
  }

  /**
   * Clear pending images
   */
  private clearPendingImages(): void {
    this.pendingImages = [];
    this.updateImagePreview();
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

    // Add to input history (avoid duplicates of last entry)
    if (this.inputHistory.length === 0 || this.inputHistory[this.inputHistory.length - 1] !== content) {
      this.inputHistory.push(content);
      // Keep history manageable
      if (this.inputHistory.length > MAX_INPUT_HISTORY_SIZE) {
        this.inputHistory.shift();
      }
    }
    // Reset history navigation
    this.inputHistoryIndex = -1;
    this.inputDraft = '';

    this.inputEl.value = '';
    this.setProcessing(true);
    this.setStatus('Thinking...', 'info');

    // Get the backend and update settings
    const backend = this.getBackend();
    backend.updateSettings(this.plugin.settings);

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

        // Update account badge (may have loaded account info during query)
        this.updateAccountBadge();

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
          const costInfo = result.totalCost
            ? ` (Cost: $${result.totalCost.toFixed(4)})`
            : '';
          const queueInfo = this.messageQueue.length > 0
            ? ` | ${this.messageQueue.length} queued`
            : '';
          this.showTemporaryStatus(`Complete${costInfo}${queueInfo}`, 'success');
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
        if (this.messageQueue.length > 0) {
          // Small delay before processing next to allow UI to update
          setTimeout(() => this.processNextInQueue(), 500);
        }
      },

      onError: (error) => {
        this.setProcessing(false);
        this.setStatus(`Error: ${error.message}`, 'error');
        log.error('Agent error during message processing', error);
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

      // Collect images and clear preview
      const images = this.pendingImages.length > 0
        ? this.pendingImages.map(img => ({ data: img.data, mimeType: img.mimeType, filename: img.filename }))
        : undefined;
      this.clearPendingImages();

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
    log.info('User stopped generation');
    this.getBackend().abort();
    this.setProcessing(false);
    this.setStatus('Stopped', 'info');
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
      this.autoResizeInput();
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
      this.voiceButton.addClass('recording');
      setIcon(this.voiceButton, 'mic-off');
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
    this.voiceButton.removeClass('recording');
    setIcon(this.voiceButton, 'mic');
    this.setStatus('');
    log.info('Voice input stopped');
  }

  /**
   * Get selected text from the active editor, if any.
   * Returns the selection with line numbers for context.
   */
  private getEditorSelection(): { text: string; startLine: number; endLine: number } | null {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;

    const editor = view.editor;
    const selection = editor.getSelection();

    // Only return if there's actual selected text (not just cursor position)
    if (!selection || selection.trim().length === 0) return null;

    const from = editor.getCursor('from');
    const to = editor.getCursor('to');

    return {
      text: selection,
      startLine: from.line + 1, // 1-indexed for display
      endLine: to.line + 1,
    };
  }

  /**
   * Compute a diff between old and new note content.
   * Returns a formatted string showing only the changed lines with context.
   */
  private computeNoteDelta(oldContent: string, newContent: string): string | null {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const contextLines = 2; // Lines of context around changes
    const changes: string[] = [];

    // Simple line-by-line comparison to find changed regions
    const maxLen = Math.max(oldLines.length, newLines.length);
    let inChange = false;
    let changeStart = -1;

    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];
      const isDifferent = oldLine !== newLine;

      if (isDifferent && !inChange) {
        // Start of a change region
        inChange = true;
        changeStart = Math.max(0, i - contextLines);
      } else if (!isDifferent && inChange) {
        // End of a change region - output it with context
        const changeEnd = Math.min(newLines.length, i + contextLines);
        changes.push(this.formatChangeRegion(oldLines, newLines, changeStart, i - 1, changeEnd));
        inChange = false;
      }
    }

    // Handle change at end of file
    if (inChange) {
      const changeEnd = newLines.length;
      changes.push(this.formatChangeRegion(oldLines, newLines, changeStart, maxLen - 1, changeEnd));
    }

    if (changes.length === 0) {
      return null;
    }

    return changes.join('\n---\n');
  }

  /**
   * Format a single change region with context lines.
   * Uses diff-style markers: - for removed, + for added, space for context.
   */
  private formatChangeRegion(
    oldLines: string[],
    newLines: string[],
    contextStart: number,
    changeEnd: number,
    contextEnd: number
  ): string {
    const result: string[] = [];
    result.push(`[Lines ${contextStart + 1}-${contextEnd}]`);

    for (let i = contextStart; i < contextEnd; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine === newLine) {
        // Context line (unchanged)
        result.push(`  ${newLine ?? ''}`);
      } else if (oldLine === undefined) {
        // Added line
        result.push(`+ ${newLine}`);
      } else if (newLine === undefined) {
        // Removed line
        result.push(`- ${oldLine}`);
      } else {
        // Changed line
        result.push(`- ${oldLine}`);
        result.push(`+ ${newLine}`);
      }
    }

    return result.join('\n');
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
    if (this.historyVisible) {
      this.historyVisible = false;
      this.historyPanel.style.display = 'none';
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

  // ===== MOBILE SUPPORT =====

  /**
   * Check if running on mobile device.
   */
  private isMobile(): boolean {
    return document.body.classList.contains('is-mobile');
  }

  /**
   * Create floating action button for mobile.
   */
  private createMobileFAB(container: HTMLElement): void {
    const fab = container.createDiv('chat-fab');
    setIcon(fab, 'plus');
    fab.setAttribute('aria-label', 'New conversation');
    fab.onclick = () => this._newConversation();
  }

  /**
   * Set up touch gesture handling for mobile.
   */
  private setupMobileTouchHandling(container: HTMLElement): void {
    if (!this.isMobile()) return;

    let touchStartX = 0;
    let touchStartY = 0;
    const swipeThreshold = 50;

    // Track touch start
    container.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
    }, { passive: true });

    // Handle swipe gestures
    container.addEventListener('touchend', (e) => {
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;

      // Horizontal swipe detection
      if (Math.abs(deltaX) > swipeThreshold && Math.abs(deltaX) > Math.abs(deltaY)) {
        if (deltaX > 0) {
          // Swipe right: show history
          if (!this.historyVisible) {
            this._toggleHistory();
          }
        } else {
          // Swipe left: hide history if open
          if (this.historyVisible) {
            this._toggleHistory();
          }
        }
      }
    }, { passive: true });

    // Long press on messages for actions
    this.messagesContainer.addEventListener('contextmenu', (e) => {
      // Prevent default context menu on mobile
      if (this.isMobile()) {
        e.preventDefault();
      }
    });

    // Add swipe hint to empty state
    this.addMobileSwipeHint();
  }

  /**
   * Add swipe gesture hint for mobile users.
   */
  private addMobileSwipeHint(): void {
    if (!this.isMobile() || this.conversation.messages.length > 0) return;

    const hint = this.messagesContainer.createDiv('swipe-hint');
    hint.setText('Swipe right for history • Tap + for new chat');
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
   * Render the tab bar UI.
   */
  private renderTabBar(): void {
    if (!this.tabBar) return;
    this.tabBar.empty();

    // Only show tab bar if we have multiple tabs or user explicitly enabled
    if (this.tabs.length <= 1 && !this.tabsEnabled) {
      this.tabBar.style.display = 'none';
      return;
    }
    this.tabBar.style.display = 'flex';

    // Render each tab
    for (const tab of this.tabs) {
      const tabEl = this.tabBar.createDiv({
        cls: `chat-tab ${tab.id === this.activeTabId ? 'chat-tab-active' : ''}`,
      });

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
      labelEl.setText(tab.label.slice(0, 20) + (tab.label.length > 20 ? '...' : ''));
      labelEl.setAttribute('title', tab.label);

      // Click to switch
      tabEl.onclick = (e) => {
        e.stopPropagation();
        this.switchToTab(tab.id);
      };

      // Close button (unless pinned)
      if (!tab.pinned && this.tabs.length > 1) {
        const closeBtn = tabEl.createSpan('chat-tab-close');
        setIcon(closeBtn, 'x');
        closeBtn.onclick = (e) => {
          e.stopPropagation();
          this.closeTab(tab.id);
        };
      }

      // Right-click context menu
      tabEl.oncontextmenu = (e) => {
        e.preventDefault();
        this.showTabContextMenu(e, tab);
      };
    }

    // New tab button
    const newTabBtn = this.tabBar.createDiv('chat-tab-new');
    setIcon(newTabBtn, 'plus');
    newTabBtn.setAttribute('aria-label', 'New tab');
    newTabBtn.onclick = () => this.createNewTab();
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
    this.renderTabBar();
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
    this.renderTabBar();
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
      this.renderTabBar();
      await this.saveTabState();
    }
  }

  /**
   * Show context menu for a tab.
   */
  private showTabContextMenu(event: MouseEvent, tab: ChatTab): void {
    const menu = new (require('obsidian').Menu)();

    menu.addItem((item: { setTitle: (arg0: string) => { (): unknown; new(): unknown; setIcon: { (arg0: string): { (): unknown; new(): unknown; onClick: { (arg0: () => void): unknown; new(): unknown } } } } }) => {
      item.setTitle(tab.pinned ? 'Unpin tab' : 'Pin tab')
        .setIcon('pin')
        .onClick(() => {
          tab.pinned = !tab.pinned;
          this.renderTabBar();
          this.saveTabState();
        });
    });

    menu.addItem((item: { setTitle: (arg0: string) => { (): unknown; new(): unknown; setIcon: { (arg0: string): { (): unknown; new(): unknown; onClick: { (arg0: () => void): unknown; new(): unknown } } } } }) => {
      item.setTitle('Rename tab')
        .setIcon('pencil')
        .onClick(() => {
          const newName = prompt('Enter new tab name:', tab.label);
          if (newName) {
            tab.label = newName;
            this.renderTabBar();
            this.saveTabState();
          }
        });
    });

    menu.addItem((item: { setTitle: (arg0: string) => { (): unknown; new(): unknown; setIcon: { (arg0: string): { (): unknown; new(): unknown; onClick: { (arg0: () => void): unknown; new(): unknown } } } } }) => {
      item.setTitle('Duplicate tab')
        .setIcon('copy')
        .onClick(async () => {
          const newTab: ChatTab = {
            id: generateId(),
            conversationId: tab.conversationId,
            label: `${tab.label} (copy)`,
          };
          this.tabs.push(newTab);
          this.renderTabBar();
          await this.saveTabState();
        });
    });

    if (!tab.pinned && this.tabs.length > 1) {
      menu.addSeparator();
      menu.addItem((item: { setTitle: (arg0: string) => { (): unknown; new(): unknown; setIcon: { (arg0: string): { (): unknown; new(): unknown; onClick: { (arg0: () => Promise<void>): unknown; new(): unknown } } } } }) => {
        item.setTitle('Close tab')
          .setIcon('x')
          .onClick(async () => {
            await this.closeTab(tab.id);
          });
      });

      menu.addItem((item: { setTitle: (arg0: string) => { (): unknown; new(): unknown; setIcon: { (arg0: string): { (): unknown; new(): unknown; onClick: { (arg0: () => Promise<void>): unknown; new(): unknown } } } } }) => {
        item.setTitle('Close other tabs')
          .setIcon('x-circle')
          .onClick(async () => {
            const otherTabs = this.tabs.filter(t => t.id !== tab.id && !t.pinned);
            for (const other of otherTabs) {
              await this.closeTab(other.id);
            }
          });
      });
    }

    menu.showAtMouseEvent(event);
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
      this.renderTabBar();
    }
  }

  async onClose(): Promise<void> {
    log.info('Closing chat view');
    // Save tabs and conversation before closing
    await this.saveTabState();
    await this.saveConversation();
  }
}
