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
import { AgentService, type AgentCallbacks, type AgentResult } from './AgentService';

export const CHAT_VIEW_TYPE = 'obsidi-claude-chat';

export class ChatView extends ItemView {
  plugin: ObsidiClaudePlugin;
  agentService: AgentService;

  // UI elements
  private messagesContainer: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendButton: HTMLButtonElement;
  private stopButton: HTMLButtonElement;
  private statusEl: HTMLElement;
  private historyPanel: HTMLElement;
  private historyList: HTMLElement;
  private chatTitleEl: HTMLElement;

  // State
  private conversation: Conversation;
  private isProcessing = false;
  private messageElements: Map<string, HTMLElement> = new Map();
  private historyVisible = false;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidiClaudePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.agentService = new AgentService(plugin.settings);
    this.conversation = this.createNewConversation();
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

    // Messages area
    this.messagesContainer = container.createDiv('chat-messages');

    // Status indicator
    this.statusEl = container.createDiv('chat-status');
    this.statusEl.style.display = 'none';

    // Input area
    const inputArea = container.createDiv('chat-input-area');
    this.createInputArea(inputArea);

    // Load saved conversation
    await this.loadConversation();
    this.renderAllMessages();
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

    const actionsEl = header.createDiv('chat-actions');

    // New conversation button
    const newBtn = actionsEl.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'New conversation' },
    });
    setIcon(newBtn, 'plus');
    newBtn.onclick = () => this.newConversation();

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
      await this.plugin.storage.setCurrentConversationId(id);
      this.renderAllMessages();
      this.updateTitle();
      this.toggleHistory();
    }
  }

  private async continueConversation(id: string): Promise<void> {
    await this.loadConversationById(id);

    if (this.conversation.sessionId) {
      this.setStatus('Session restored - ready to continue', 'success');
      setTimeout(() => this.setStatus(''), 3000);
    } else {
      this.setStatus('No session to resume - starting fresh', 'info');
      setTimeout(() => this.setStatus(''), 3000);
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
    // Textarea
    this.inputEl = inputArea.createEl('textarea', {
      cls: 'chat-input',
      attr: {
        placeholder: 'Ask Claude anything... (Enter to send, Shift+Enter for newline)',
        rows: '3',
      },
    });

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Button container
    const buttonArea = inputArea.createDiv('chat-buttons');

    // Stop button (hidden by default)
    this.stopButton = buttonArea.createEl('button', {
      cls: 'chat-stop-btn',
      text: 'Stop',
    });
    this.stopButton.style.display = 'none';
    this.stopButton.onclick = () => this.stopGeneration();

    // Send button
    this.sendButton = buttonArea.createEl('button', {
      cls: 'chat-send-btn mod-cta',
      text: 'Send',
    });
    this.sendButton.onclick = () => this.sendMessage();
  }

  private createNewConversation(): Conversation {
    return {
      id: generateId(),
      title: 'New Conversation',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private async loadConversation(): Promise<void> {
    try {
      this.conversation = await this.plugin.storage.getCurrentConversation();
      this.updateTitle();
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  }

  private async saveConversation(): Promise<void> {
    // Update session ID
    const sessionId = this.agentService.getSessionId();
    if (sessionId) {
      this.conversation.sessionId = sessionId;
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
    this.scrollToBottom();
  }

  private renderMessage(msg: ChatMessage): HTMLElement | null {
    if (!this.messagesContainer) return null;
    const msgDiv = this.messagesContainer.createDiv('chat-message');
    msgDiv.addClass(
      msg.role === 'user' ? 'user-message' : 'assistant-message'
    );
    msgDiv.dataset.messageId = msg.id;

    // Role label
    const roleLabel = msgDiv.createDiv('message-role');
    roleLabel.setText(msg.role === 'user' ? 'You' : 'Claude');

    // Timestamp
    const timeEl = msgDiv.createDiv('message-time');
    timeEl.setText(new Date(msg.timestamp).toLocaleTimeString());

    // Content
    const contentDiv = msgDiv.createDiv('message-content');

    if (msg.content) {
      MarkdownRenderer.render(
        this.plugin.app,
        msg.content,
        contentDiv,
        '',
        new Component()
      );
    } else if (msg.isStreaming) {
      contentDiv.createDiv('typing-indicator').setText('...');
    }

    // Tool calls (if any)
    if (msg.toolCalls && msg.toolCalls.length > 0 && this.plugin.settings.showToolCalls) {
      const toolsDiv = msgDiv.createDiv('message-tools');
      for (const tool of msg.toolCalls) {
        this.renderToolCall(toolsDiv, tool);
      }
    }

    this.messageElements.set(msg.id, msgDiv);
    return msgDiv;
  }

  private renderToolCall(container: HTMLElement, tool: ToolCallInfo): void {
    const toolDiv = container.createDiv('tool-call');
    toolDiv.addClass(`tool-status-${tool.status}`);

    const iconEl = toolDiv.createSpan('tool-icon');
    const statusIcon =
      tool.status === 'completed'
        ? 'check'
        : tool.status === 'running'
          ? 'loader'
          : tool.status === 'error'
            ? 'x'
            : 'clock';
    setIcon(iconEl, statusIcon);

    const nameEl = toolDiv.createSpan('tool-name');
    nameEl.setText(tool.name);

    if (tool.result && tool.status === 'completed') {
      const resultEl = toolDiv.createDiv('tool-result');
      // Truncate long results
      const truncated =
        tool.result.length > 200
          ? tool.result.substring(0, 200) + '...'
          : tool.result;
      resultEl.setText(truncated);
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
    }

    this.scrollToBottom();
  }

  private updateMessageTools(messageId: string, toolCalls: ToolCallInfo[]): void {
    const msgEl = this.messageElements.get(messageId);
    if (!msgEl) return;

    let toolsDiv = msgEl.querySelector('.message-tools') as HTMLElement;
    if (!toolsDiv) {
      toolsDiv = msgEl.createDiv('message-tools');
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

  private setProcessing(processing: boolean): void {
    this.isProcessing = processing;
    if (!this.sendButton || !this.stopButton || !this.inputEl) return;
    this.sendButton.style.display = processing ? 'none' : 'block';
    this.stopButton.style.display = processing ? 'block' : 'none';
    this.inputEl.disabled = processing;
  }

  private async sendMessage(): Promise<void> {
    const content = this.inputEl.value.trim();
    if (!content || this.isProcessing) return;

    this.inputEl.value = '';
    this.setProcessing(true);
    this.setStatus('Thinking...', 'info');

    // Update agent service settings
    this.agentService.updateSettings(this.plugin.settings);

    // Track current assistant message for updates
    let currentAssistantMsgId: string | null = null;
    const currentToolCalls: ToolCallInfo[] = [];

    const callbacks: AgentCallbacks = {
      onMessage: (msg) => {
        this.conversation.messages.push(msg);
        this.renderMessage(msg);

        if (msg.role === 'assistant') {
          currentAssistantMsgId = msg.id;
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
        this.conversation.sessionId = sessionId;
        console.log('Session initialized:', sessionId);
        console.log('Available tools:', tools);
      },

      onComplete: async (result) => {
        this.setProcessing(false);

        if (result.success) {
          const costInfo = result.totalCost
            ? ` (Cost: $${result.totalCost.toFixed(4)})`
            : '';
          this.setStatus(`Complete${costInfo}`, 'success');

          // Clear status after 3 seconds
          setTimeout(() => this.setStatus(''), 3000);
        } else {
          this.setStatus(
            `Errors: ${result.errors?.join(', ') || 'Unknown error'}`,
            'error'
          );
        }

        // Save conversation
        this.conversation.updatedAt = Date.now();
        await this.saveConversation();
      },

      onError: (error) => {
        this.setProcessing(false);
        this.setStatus(`Error: ${error.message}`, 'error');
        console.error('Agent error:', error);
      },
    };

    try {
      await this.agentService.sendMessage(
        content,
        this.conversation.messages,
        callbacks,
        this.conversation.sessionId
      );
    } catch (error) {
      callbacks.onError(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private stopGeneration(): void {
    this.agentService.abort();
    this.setProcessing(false);
    this.setStatus('Stopped', 'info');
  }

  private async newConversation(): Promise<void> {
    this.conversation = await this.plugin.storage.createConversation();
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

  private async clearMessages(): Promise<void> {
    this.conversation.messages = [];
    this.conversation.sessionId = undefined;
    this.renderAllMessages();
    await this.saveConversation();
    this.setStatus('Messages cleared', 'info');
    setTimeout(() => this.setStatus(''), 2000);
  }

  private scrollToBottom(): void {
    if (!this.messagesContainer) return;
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  async onClose(): Promise<void> {
    // Save before closing
    await this.saveConversation();
  }
}
