import {
  ItemView,
  WorkspaceLeaf,
  MarkdownRenderer,
  Component,
  setIcon,
} from 'obsidian';
import type ObsidiClaudePlugin from '../main';
import type { ChatMessage, ToolCallInfo, Conversation } from './types';
import { generateId } from './types';
import type { AgentBackend, AgentCallbacks, AgentResult } from './backends';
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
  private statusEl: HTMLElement;
  private historyPanel: HTMLElement;
  private historyList: HTMLElement;
  private chatTitleEl: HTMLElement;
  private backendBadge: HTMLElement;
  private contextBadge: HTMLElement;
  private tokenCounter: HTMLElement;
  private searchInput: HTMLInputElement;
  private searchContainer: HTMLElement;

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

  // Input history for up/down arrow navigation
  private inputHistory: string[] = [];
  private inputHistoryIndex = -1;
  private inputDraft = ''; // Saves current input when navigating history

  // Track last sent note to avoid redundant context injection
  private lastSentNotePath: string | null = null;
  private lastSentNoteContent: string | null = null;

  // Message queue for queueing messages while processing
  private messageQueue: { content: string; timestamp: number }[] = [];
  private queueContainer: HTMLElement;
  private queueBadge: HTMLElement;

  // Input wrapper for processing state styling
  private inputWrapper!: HTMLElement;

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
    log.debug('Chat view opened', { conversationId: this.conversation.id });
  }

  private registerKeyboardShortcuts(container: HTMLElement): void {
    // Use keydown on the container for global shortcuts
    container.addEventListener('keydown', (e) => {
      // Ctrl/Cmd+F for search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        this.toggleSearch();
      }

      // Escape to close search or history
      if (e.key === 'Escape') {
        if (this.searchVisible) {
          this.toggleSearch();
        } else if (this.historyVisible) {
          this.toggleHistory();
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
    historyBtn.onclick = () => this.toggleHistory();

    // Title (clickable to show history)
    this.chatTitleEl = header.createDiv('chat-title');
    this.chatTitleEl.setText('Claude Chat');
    this.chatTitleEl.onclick = () => this.toggleHistory();

    // Backend indicator badge
    this.backendBadge = header.createDiv('backend-badge');
    this.updateBackendBadge();

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
    searchBtn.onclick = () => this.toggleSearch();

    // New conversation button
    const newBtn = actionsEl.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'New conversation' },
    });
    setIcon(newBtn, 'plus');
    newBtn.onclick = () => this.newConversation();

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
    clearBtn.onclick = () => this.clearMessages();
  }

  private createHistoryPanel(panel: HTMLElement): void {
    const header = panel.createDiv('history-header');
    header.createEl('h4', { text: 'Conversations' });

    const closeBtn = header.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'Close history' },
    });
    setIcon(closeBtn, 'x');
    closeBtn.onclick = () => this.toggleHistory();

    this.historyList = panel.createDiv('history-list');
  }

  private async toggleHistory(): Promise<void> {
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
        this.toggleSearch();
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
    closeBtn.onclick = () => this.toggleSearch();
  }

  private toggleSearch(): void {
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
    this.messagesContainer.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = this.messagesContainer;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      // User is "near bottom" if within threshold of the bottom
      this.userScrolledUp = distanceFromBottom > SCROLL_THRESHOLD_PX;
    });
  }

  private async refreshHistoryList(): Promise<void> {
    if (!this.historyList) return;
    this.historyList.empty();

    const conversations = await this.plugin.storage.listConversations();

    if (conversations.length === 0) {
      this.historyList.createDiv('history-empty').setText('No conversations yet');
      return;
    }

    for (const conv of conversations) {
      const item = this.historyList.createDiv('history-item');
      if (conv.id === this.conversation.id) {
        item.addClass('history-item-active');
      }

      const info = item.createDiv('history-item-info');

      const title = info.createDiv('history-item-title');
      title.setText(conv.title || 'Untitled');

      const meta = info.createDiv('history-item-meta');
      const date = new Date(conv.updatedAt);
      const dateStr = this.formatRelativeDate(date);
      meta.setText(`${conv.messageCount} messages · ${dateStr}`);

      // Click to load
      item.onclick = () => this.loadConversationById(conv.id);

      // Actions
      const actions = item.createDiv('history-item-actions');

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

  private async loadConversationById(id: string): Promise<void> {
    const conv = await this.plugin.storage.loadConversation(id);
    if (conv) {
      this.conversation = conv;
      this.lastSentNotePath = null; // Reset note tracking when switching conversations
      this.lastSentNoteContent = null;
      await this.plugin.storage.setCurrentConversationId(id);
      this.renderAllMessages();
      this.updateTitle();
      this.toggleHistory();
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
        await this.newConversation();
      }
    }

    await this.refreshHistoryList();
  }

  private updateTitle(): void {
    if (!this.chatTitleEl) return;
    const title = this.conversation.title || 'New Conversation';
    this.chatTitleEl.setText(title.length > 30 ? title.slice(0, 30) + '...' : title);
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

    // Auto-resize textarea
    this.inputEl.addEventListener('input', () => {
      this.inputEl.style.height = 'auto';
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, MAX_TEXTAREA_HEIGHT_PX) + 'px';
    });

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

    // Message action buttons (shown on hover)
    const actionsDiv = msgDiv.createDiv('message-actions');
    this.createMessageActions(actionsDiv, msg);

    this.messageElements.set(msg.id, msgDiv);
    return msgDiv;
  }

  private createMessageActions(container: HTMLElement, msg: ChatMessage): void {
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

    // Only show regenerate for assistant messages
    if (msg.role === 'assistant') {
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
    this.inputEl.disabled = processing;

    // Add/remove processing class for visual feedback
    if (this.inputWrapper) {
      this.inputWrapper.toggleClass('is-processing', processing);
    }
  }

  /**
   * Handle slash commands like /clear, /new, /note, /help
   * Returns true if the command was handled, false if it should be sent as a message
   */
  private async handleSlashCommand(input: string): Promise<boolean> {
    const parts = input.slice(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    log.debug('Processing slash command', { command, args });

    switch (command) {
      case 'clear':
        await this.clearMessages();
        return true;

      case 'new':
        await this.newConversation();
        return true;

      case 'export':
        await this.exportConversation();
        return true;

      case 'note': {
        // Insert current note content into the input
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) {
          this.showTemporaryStatus('No active note', 'info', 2000);
          return true;
        }

        try {
          const noteContent = await this.plugin.app.vault.read(activeFile);
          const contextMessage = `[Context from "${activeFile.basename}"]\n\n${noteContent}`;

          // If there are additional args, append them as a question
          if (args) {
            this.inputEl.value = `${contextMessage}\n\n---\n\n${args}`;
          } else {
            this.inputEl.value = contextMessage;
          }

          // Trigger resize
          this.inputEl.style.height = 'auto';
          this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, MAX_TEXTAREA_HEIGHT_PX) + 'px';
          this.inputEl.focus();
          this.showTemporaryStatus(`Added "${activeFile.basename}" to input`, 'success', 2000);
        } catch (error) {
          log.error('Failed to read active note', error);
          this.setStatus('Failed to read note', 'error');
        }
        return true;
      }

      case 'search':
        if (args) {
          this.searchInput.value = args;
          this.performSearch(args);
        }
        if (!this.searchVisible) {
          this.toggleSearch();
        }
        return true;

      case 'queue':
        if (args === 'clear') {
          this.clearQueue();
        } else {
          const count = this.messageQueue.length;
          if (count === 0) {
            this.showTemporaryStatus('Message queue is empty', 'info', 2000);
          } else {
            this.showTemporaryStatus(`${count} message${count !== 1 ? 's' : ''} in queue`, 'info', 2000);
          }
        }
        return true;

      case 'help':
      case '?':
        this.showSlashCommandHelp();
        return true;

      default:
        // Unknown command - show help hint
        this.showTemporaryStatus(`Unknown command: /${command}. Type /help for available commands.`, 'info');
        return true;
    }
  }

  private showSlashCommandHelp(): void {
    const helpText = `
**Available Commands:**
- \`/clear\` - Clear all messages
- \`/new\` - Start new conversation
- \`/export\` - Export chat as markdown note
- \`/note [question]\` - Insert current note as context
- \`/search <query>\` - Search messages
- \`/queue [clear]\` - Show queue status or clear it
- \`/help\` - Show this help

**Keyboard Shortcuts:**
- \`Enter\` - Send message (or queue if busy)
- \`Shift+Enter\` - New line
- \`↑/↓\` - Navigate input history
- \`Ctrl/Cmd+F\` - Search messages

**Message Queue:**
When Claude is busy, messages are automatically queued and processed in order.
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

  private async sendMessage(): Promise<void> {
    const content = this.inputEl.value.trim();
    if (!content) return;

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
    };

    try {
      // Build enhanced system prompt with active skills
      const basePrompt = this.plugin.settings.systemPrompt;
      const enhancedPrompt = this.plugin.skillRegistry.buildSystemPrompt(
        basePrompt,
        content
      );

      // Build message with optional active note context
      // Only include note content when needed:
      // - Full content for new notes
      // - Delta (changed lines) for same note with changes
      // - Nothing for same note with no changes
      let messageContent = content;
      if (this.plugin.settings.activeNoteContext) {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === 'md') {
          const notePath = activeFile.path;
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
              // Same note but content changed - send only the delta
              const delta = this.computeNoteDelta(this.lastSentNoteContent, noteContent);
              if (delta) {
                messageContent = `<active_note_changes path="${notePath}">\n${delta}\n</active_note_changes>\n\n${content}`;
                log.debug('Included note delta', { path: notePath, deltaLength: delta.length });
              }
              this.lastSentNoteContent = noteContent;
            }
            // If same note and no changes, just send the user's message
          } catch (err) {
            log.warn('Failed to read active note for context', { path: notePath, error: err });
          }
        }
      }

      await backend.sendMessage(
        messageContent,
        this.conversation,
        callbacks,
        {
          resumeSessionId: this.conversation.metadata?.sessionId ?? this.conversation.sessionId,
          systemPrompt: enhancedPrompt,
          displayContent: content, // Show only user's actual input, not note context
        }
      );
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

  private async newConversation(): Promise<void> {
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

  private async clearMessages(): Promise<void> {
    log.info('Clearing messages', { conversationId: this.conversation.id });
    this.conversation.messages = [];
    this.conversation.sessionId = undefined;
    this.renderAllMessages();
    await this.saveConversation();
    this.showTemporaryStatus('Messages cleared', 'info', 2000);
  }

  private scrollToBottom(force = false): void {
    if (!this.messagesContainer) return;
    // Only auto-scroll if user hasn't scrolled up, or if forced
    if (!this.userScrolledUp || force) {
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
  }

  async onClose(): Promise<void> {
    log.info('Closing chat view');
    // Save before closing
    await this.saveConversation();
  }
}
