/**
 * ChatView - Main chat interface for Obsidian Claude plugin.
 * This file is pure orchestration - all heavy lifting is delegated to modules.
 */
import {
  ItemView,
  WorkspaceLeaf,
  setIcon,
  Notice,
  Menu,
} from 'obsidian';
import { PermissionModal } from './chatViewModals';
import { executeCommand, getCommandList, type ChatViewCommandContext } from './chatViewCommands';
import type ObsidiClaudePlugin from '../main';
import type { ChatMessage, ToolCallInfo, Conversation, ChatTab } from './types';
import { generateId, calculateCost, calculateConversationUsage } from './types';
import type { AgentBackend, AgentCallbacks } from './backends';
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
  createAutocomplete,
  createExportHandler,
  createKeyboardHandler,
  createVoiceInput,
  createScrollManager,
  type SearchBarHandle,
  type QueuePanelHandle,
  type StatusBarHandle,
  type MobileSupportHandle,
  type TabBarHandle,
  type MessageRendererHandle,
  type InputAreaHandle,
  type HistoryPanelHandle,
  type MessageOrchestratorHandle,
  type SlashCommandsHandle,
  type ContextLoaderHandle,
  type ContextInfo,
  type AutocompleteHandle,
  type ExportHandlerHandle,
  type KeyboardHandlerHandle,
  type VoiceInputHandle,
  type ScrollManagerHandle,
  type CommandHandlerDeps,
  handleToolsCommand,
  handleContextCommand,
  handleDuplicateCommand,
  showBookmarks,
  showCostSummary,
  showConversationStats,
  showUsageDashboard,
  handleUndoCommand,
  handleBudgetCommand,
  handlePromptsCommand,
  handleMcpCommand,
  handlePermissionModeCommand,
  handleExtractCommand,
  handleAnalyzeNoteCommand,
  generateNoteFromConversation,
  promptRenameConversation,
  promptManageTags,
} from './chatView/index';

const log = createLogger('ChatView');

// Constants
const CHARS_PER_TOKEN_ESTIMATE = 4;

export const CHAT_VIEW_TYPE = 'obsidi-claude-chat';

export class ChatView extends ItemView {
  plugin: ObsidiClaudePlugin;

  // Core UI elements (minimal set needed for orchestration)
  private messagesContainer!: HTMLElement;
  private statusEl!: HTMLElement;
  private chatTitleEl!: HTMLElement;
  private searchContainer!: HTMLElement;
  private queueContainer!: HTMLElement;
  private statusBadgesContainer: HTMLElement | null = null;
  private inputEl!: HTMLTextAreaElement;
  private inputWrapper!: HTMLElement;

  // State
  private conversation!: Conversation;
  private isProcessing = false;
  private messageElements = new Map<string, HTMLElement>();
  private searchVisible = false;
  private vaultRefreshTimeout: ReturnType<typeof setTimeout> | null = null;

  // Tab management
  private tabs: ChatTab[] = [];
  private activeTabId: string | null = null;

  // Module handles
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
  private autocompleteModule: AutocompleteHandle | null = null;
  private exportModule: ExportHandlerHandle | null = null;
  private keyboardModule: KeyboardHandlerHandle | null = null;
  private voiceModule: VoiceInputHandle | null = null;
  private scrollModule: ScrollManagerHandle | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidiClaudePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  private getBackend(): AgentBackend {
    return this.plugin.backendFactory.getBackend();
  }

  getViewType(): string { return CHAT_VIEW_TYPE; }
  getDisplayText(): string { return 'Claude Chat'; }
  getIcon(): string { return 'message-circle'; }

  async onOpen(): Promise<void> {
    log.info('Opening chat view');
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('obsidi-claude-container');

    this.conversation = this.createNewConversation();
    const deps = { app: this.plugin.app, plugin: this.plugin };

    // Build UI structure
    this.buildHeader(container);
    this.buildTabBar(container, deps);
    this.buildHistoryPanel(container, deps);
    this.buildSearchBar(container, deps);
    this.buildQueuePanel(container, deps);
    this.buildMessagesArea(container, deps);
    this.buildStatusElement(container);
    this.buildVoiceInput();
    this.buildInputArea(container, deps);
    this.buildAutocomplete(deps);
    this.buildStatusBar(deps);
    this.buildContextLoader(deps);
    this.buildMessageOrchestrator(deps);
    this.buildMobileSupport(container, deps);
    this.buildSlashCommands(deps);
    this.buildExportHandler(deps);
    this.buildKeyboardHandler(container, deps);

    // Register events and load data
    this.registerEvent(
      this.plugin.app.workspace.on('active-leaf-change', () => this.updateContextBadge())
    );

    await this.loadConversation();
    this.renderAllMessages();
    this.setupHookCallbacks();

    log.debug('Chat view opened', { conversationId: this.conversation.id });
  }

  private buildHeader(container: HTMLElement): void {
    const header = container.createDiv('chat-header');
    const leftSection = header.createDiv('header-left');
    const historyBtn = leftSection.createEl('button', {
      cls: 'chat-action-btn chat-history-btn',
      attr: { 'aria-label': 'Conversation history' },
    });
    setIcon(historyBtn, 'menu');
    historyBtn.onclick = () => this.historyModule?.toggle();

    const centerSection = header.createDiv('header-center');
    this.chatTitleEl = centerSection.createDiv('chat-title');
    this.chatTitleEl.setText('Claude Chat');
    this.chatTitleEl.onclick = () => this.historyModule?.toggle();
    this.statusBadgesContainer = centerSection.createDiv('header-status');

    const rightSection = header.createDiv('header-right');
    const newBtn = rightSection.createEl('button', {
      cls: 'chat-action-btn chat-new-btn',
      attr: { 'aria-label': 'New conversation' },
    });
    setIcon(newBtn, 'plus');
    newBtn.onclick = () => this.newConversation();

    const moreBtn = rightSection.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'More options' },
    });
    setIcon(moreBtn, 'more-vertical');
    moreBtn.onclick = (e) => this.showHeaderMenu(e);
  }

  private buildTabBar(container: HTMLElement, deps: { app: typeof this.plugin.app; plugin: typeof this.plugin }): void {
    const tabBarContainer = container.createDiv();
    this.initializeTabs();
    this.tabModule = createTabBar(tabBarContainer, deps, {
      onTabSelect: (tabId) => this.switchToTab(tabId),
      onTabClose: (tabId) => this.closeTab(tabId),
      onNewTab: () => this.createNewTab(),
      onTabRename: (tabId, newLabel) => {
        const tab = this.tabs.find(t => t.id === tabId);
        if (tab) { tab.label = newLabel; this.tabModule?.render(); this.saveTabState(); }
      },
      onTabPin: (tabId, pinned) => {
        const tab = this.tabs.find(t => t.id === tabId);
        if (tab) { tab.pinned = pinned; this.tabModule?.render(); this.saveTabState(); }
      },
      onTabDuplicate: (tabId) => {
        const tab = this.tabs.find(t => t.id === tabId);
        if (tab) {
          this.tabs.push({ id: generateId(), conversationId: tab.conversationId, label: `${tab.label} (copy)` });
          this.tabModule?.render(); this.saveTabState();
        }
      },
      onCloseOtherTabs: async (tabId) => {
        for (const other of this.tabs.filter(t => t.id !== tabId && !t.pinned)) {
          await this.closeTab(other.id);
        }
      },
      getTabs: () => this.tabs.map(t => ({ id: t.id, label: t.label, conversationId: t.conversationId, pinned: t.pinned, linkedPath: t.linkedPath })),
      getActiveTabId: () => this.activeTabId,
      getTabCount: () => this.tabs.length,
    });
    this.tabModule?.setVisible(this.tabs.length > 1);
  }

  private buildHistoryPanel(container: HTMLElement, deps: { app: typeof this.plugin.app; plugin: typeof this.plugin }): void {
    this.historyModule = createHistoryPanel(container.createDiv('chat-history-container'), deps, {
      onSelect: (id) => this.loadConversationById(id), onDelete: (id) => this.deleteConversation(id),
      onDeleteBulk: async (ids) => { for (const id of ids) await this.plugin.storage.deleteConversation(id); this.showTemporaryStatus(`Deleted ${ids.length} conversation${ids.length > 1 ? 's' : ''}`, 'success', 2000); if (ids.includes(this.conversation.id)) { this.conversation = this.createNewConversation(); this.renderAllMessages(); } },
      onDuplicate: (id) => this.duplicateConversation(id),
      onRename: async (id, title) => { await this.plugin.storage.renameConversation(id, title); this.showTemporaryStatus('Conversation renamed', 'success', 1500); if (this.conversation.id === id) { this.conversation.title = title; this.updateTitle(); } },
      onTogglePin: async (id) => { const isPinned = await this.plugin.storage.togglePin(id); this.showTemporaryStatus(isPinned ? 'Pinned' : 'Unpinned', 'success', 1500); if (this.conversation.id === id) this.conversation.pinned = isPinned; },
      onManageTags: (id, tags) => this.handleManageTags(id, tags), onContinue: (id) => this.loadConversationById(id),
      getConversations: () => this.plugin.storage.listConversations(), getAllTags: () => this.plugin.storage.getAllTags(),
      getCurrentId: () => this.conversation.id, showStatus: (msg, type) => this.showTemporaryStatus(msg, type, 2000),
    });
  }

  private buildSearchBar(container: HTMLElement, deps: { app: typeof this.plugin.app; plugin: typeof this.plugin }): void {
    this.searchContainer = container.createDiv('search-bar-container');
    this.searchBarModule = createSearchBar(this.searchContainer, deps, {
      getMessageIds: () => this.conversation?.messages.map(m => m.id) ?? [],
      getMessageContent: (id) => this.conversation?.messages.find(m => m.id === id)?.content ?? '',
      scrollToMessage: (id) => this.messageElements.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      highlightMessage: (id) => this.messageElements.get(id)?.addClass('search-current'),
      clearHighlights: () => this.messageElements.forEach(el => { el.removeClass('search-match'); el.removeClass('search-current'); }),
    });
  }

  private buildQueuePanel(container: HTMLElement, deps: { app: typeof this.plugin.app; plugin: typeof this.plugin }): void {
    this.queueContainer = container.createDiv('queue-panel-container');
    this.queueModule = createQueuePanel(this.queueContainer, deps, {
      onRemove: () => {},
      onClear: () => this.showTemporaryStatus('Queue cleared', 'info', 2000),
    });
  }

  private buildMessagesArea(container: HTMLElement, deps: { app: typeof this.plugin.app; plugin: typeof this.plugin }): void {
    this.messagesContainer = container.createDiv('chat-messages');
    this.scrollModule = createScrollManager(this.messagesContainer, deps, { onUserScrollChange: () => {}, getMessageElement: (id) => this.messageElements.get(id) });
    this.messageModule = createMessageRenderer(this.messagesContainer, deps, {
      onCopy: (id) => { const msg = this.conversation.messages.find(m => m.id === id); if (msg) { navigator.clipboard.writeText(msg.content); this.showTemporaryStatus('Copied', 'success', 1500); } },
      onRegenerate: (id) => this.handleRegenerate(id), onEdit: (id) => { const msg = this.conversation.messages.find(m => m.id === id); if (msg) { this.inputEl.value = msg.content; this.inputEl.focus(); } },
      onReact: (id, reaction) => this.toggleReaction(id, reaction as 'up' | 'down'), onBookmark: (id) => this.toggleBookmark(id),
      onResume: (id) => { const msg = this.conversation.messages.find(m => m.id === id); if (msg) this.resumeFromMessage(msg); },
      scrollToBottom: () => this.scrollModule?.scrollToBottom(), canResume: (msg) => !!(msg.sdkUuid && this.getBackend().type === 'sdk'),
    });
  }

  private buildStatusElement(container: HTMLElement): void {
    this.statusEl = container.createDiv('chat-status');
    this.statusEl.style.display = 'none';
  }

  private buildVoiceInput(): void {
    this.voiceModule = createVoiceInput({
      onTranscript: (text) => { this.inputModule?.setValue(text); this.inputModule?.resize(); }, onError: (error) => this.showTemporaryStatus(error, 'error'),
      onStateChange: (recording) => { this.inputModule?.setRecording(recording); if (recording) this.showTemporaryStatus('Listening...', 'info', 10000); else this.setStatus(''); },
    });
  }

  private buildInputArea(container: HTMLElement, deps: { app: typeof this.plugin.app; plugin: typeof this.plugin }): void {
    this.inputModule = createInputArea(container.createDiv('chat-input-area'), deps, {
      onSend: (content) => this.sendMessage(content), onStop: () => this.stopGeneration(), onVoiceToggle: () => this.voiceModule?.toggle(),
      onImageAdd: () => {}, onImageRemove: () => {}, onInputChange: (value) => this.autocompleteModule?.update(value),
      onKeyDown: (e) => this.handleInputKeyDown(e), getCommands: () => getCommandList(), isVoiceAvailable: () => this.voiceModule?.isAvailable() ?? false,
    });
    this.inputEl = this.inputModule.getInputElement(); this.inputWrapper = this.inputModule.getWrapper();
  }

  private buildAutocomplete(deps: { app: typeof this.plugin.app; plugin: typeof this.plugin }): void {
    this.autocompleteModule = createAutocomplete(this.inputWrapper, { getCommands: () => getCommandList(), onSelect: (command) => { this.inputEl.value = command; this.inputEl.focus(); this.inputModule?.resize(); } });
  }

  private buildStatusBar(deps: { app: typeof this.plugin.app; plugin: typeof this.plugin }): void {
    if (!this.statusBadgesContainer || !this.inputModule) return;
    this.statusModule = createStatusBar({ badgesContainer: this.statusBadgesContainer, tokenContainer: this.inputModule.getButtonContainer() }, deps, {
      onBackendClick: () => {}, onAccountClick: () => {}, onTokenCounterClick: () => {},
      onContextClick: () => { this.plugin.settings.activeNoteContext = !this.plugin.settings.activeNoteContext; this.plugin.saveSettings(); this.statusModule?.refresh(); },
      getBackendInfo: () => ({ type: this.getBackend().type, label: this.getBackend().type.toUpperCase() }),
      getActiveNoteInfo: () => { const f = this.plugin.app.workspace.getActiveFile(); return this.plugin.settings.activeNoteContext && f?.extension === 'md' ? { path: f.path, title: f.basename } : null; },
      getAccountInfo: () => { const b = this.getBackend(); if (b.type !== 'sdk' || !('getAccountInfo' in b)) return null; const i = (b as { getAccountInfo(): { email?: string; organization?: string; subscriptionType?: string } | null }).getAccountInfo(); return i ? { email: i.email, name: i.organization, tier: i.subscriptionType } : null; },
      getTokenEstimate: () => ({ tokens: this.estimateTokens(), cost: (this.conversation?.usage ?? calculateConversationUsage(this.conversation?.messages ?? [])).totalCost }),
    });
    this.statusModule?.updateEphemeral(this.plugin.settings.ephemeralMode);
  }

  private buildContextLoader(deps: { app: typeof this.plugin.app; plugin: typeof this.plugin }): void {
    this.contextModule = createContextLoader(deps, { onContextChange: (info) => this.statusModule?.updateContext(info ? { path: info.path ?? '', title: info.name } : null) });
  }

  private buildMessageOrchestrator(deps: { app: typeof this.plugin.app; plugin: typeof this.plugin }): void {
    this.messageOrchestrator = createMessageOrchestrator(deps, {
      onMessageStart: (msg) => { this.renderMessage(msg); this.updateTokenCounter(); if (msg.role === 'user') this.scrollModule?.resetScrollState(); this.scrollModule?.scrollToBottom(); },
      onMessageUpdate: (id, content) => this.messageModule?.updateContent(id, content),
      onMessageComplete: (id) => { const el = this.messageElements.get(id); if (el) (el.querySelector('.message-actions') as HTMLElement)?.style.removeProperty('display'); },
      onToolCall: (id, tools) => this.messageModule?.updateTools(id, tools), onToolResult: () => {}, onError: (error) => log.error('Agent error', error),
      onProcessingChange: (processing) => this.setProcessing(processing), onStatusChange: (message, type) => this.setStatus(message, type),
      onSessionInit: (sessionId, tools) => log.info('Session initialized', { sessionId, toolCount: tools.length }), onSdkUuid: () => {},
      onToolSummary: (id, summary) => this.updateToolSummary(id, summary), onFilesPersisted: (files) => log.info('Files modified', { count: files.length }),
      onTaskNotification: (taskId, status, summary, outputFile, assistantMsgId) => this.handleTaskNotification(taskId, status, summary, outputFile, assistantMsgId),
      onCompactionStatus: (status) => this.setStatus(status === 'compacting' ? 'Compacting context...' : '', 'info'),
      onCompactionBoundary: (trigger, preTokens) => { new Notice(`Context compacted: ~${Math.round(preTokens / 1000)}K tokens (${trigger})`, 3000); if (!this.conversation.metadata) this.conversation.metadata = { backendType: 'sdk' }; if (!this.conversation.metadata.compactions) this.conversation.metadata.compactions = []; this.conversation.metadata.compactions.push({ timestamp: Date.now(), trigger, preTokens }); this.saveConversation(); },
      getBackend: () => this.getBackend(), getConversation: () => this.conversation, getContext: () => this.buildContextInfo(),
      saveConversation: () => this.saveConversation(), updateTokenCounter: () => this.updateTokenCounter(), refreshStatusBar: () => this.statusModule?.refresh(),
      scrollToBottom: () => this.scrollModule?.scrollToBottom(), getModel: () => this.plugin.settings.model,
    });
  }

  private buildMobileSupport(container: HTMLElement, deps: { app: typeof this.plugin.app; plugin: typeof this.plugin }): void {
    this.mobileModule = createMobileSupport(container, deps, { onNewConversation: () => this.newConversation(), onSwipeLeft: () => { if (this.historyModule?.isVisible()) this.historyModule.toggle(); }, onSwipeRight: () => { if (!this.historyModule?.isVisible()) this.historyModule?.toggle(); }, isMobile: () => document.body.classList.contains('is-mobile') });
    this.mobileModule.setupTouchHandling(container);
  }

  private buildSlashCommands(deps: { app: typeof this.plugin.app; plugin: typeof this.plugin }): void {
    this.slashCommandsModule = createSlashCommands(deps, {
      getCommandContext: () => this.createCommandContext(), renderMessage: (msg) => this.renderMessage(msg), scrollToBottom: (force) => this.scrollModule?.scrollToBottom(force),
      showTemporaryStatus: (msg, type, duration) => this.showTemporaryStatus(msg, type, duration), toggleHistory: () => this.historyModule?.toggle(),
      togglePin: async () => { await this.plugin.storage.togglePin(this.conversation.id); this.conversation.pinned = !this.conversation.pinned; this.showTemporaryStatus(this.conversation.pinned ? 'Pinned' : 'Unpinned', 'success', 1500); },
      renameConversation: (title) => { if (title) { this.plugin.storage.renameConversation(this.conversation.id, title); this.conversation.title = title; this.updateTitle(); this.showTemporaryStatus('Renamed', 'success', 1500); } else this.handleRenamePrompt(); },
      showStats: () => showConversationStats(this.getCommandHandlerDeps()), showUsageDashboard: () => showUsageDashboard(this.getCommandHandlerDeps()), copyToClipboard: () => this.exportModule?.copyToClipboard() ?? Promise.resolve(),
      handleToolsCommand: (args) => handleToolsCommand(args, this.getCommandHandlerDeps()), handleContextCommand: (args) => handleContextCommand(args, this.getCommandHandlerDeps(), () => this.updateContextBadge()),
      handleDuplicateCommand: () => handleDuplicateCommand(this.getCommandHandlerDeps(), async (conv) => { this.conversation = conv; await this.plugin.storage.setCurrentConversationId(conv.id); this.renderAllMessages(); this.updateTitle(); }),
      showBookmarks: () => showBookmarks(this.getCommandHandlerDeps()), handlePromptsCommand: (args) => handlePromptsCommand(args, this.getCommandHandlerDeps(), this.inputEl, () => this.inputModule?.resize()),
      handleUndoCommand: (args) => handleUndoCommand(args, this.getCommandHandlerDeps()), handleBudgetCommand: (args) => handleBudgetCommand(args, this.getCommandHandlerDeps()),
      showCostSummary: () => showCostSummary(this.getCommandHandlerDeps()), generateNote: (args) => generateNoteFromConversation(args, this.getCommandHandlerDeps()),
      handleModeCommand: (args) => handlePermissionModeCommand(args, this.getCommandHandlerDeps()), handleMcpCommand: (args) => handleMcpCommand(args, this.getCommandHandlerDeps()),
      handleExtractCommand: () => handleExtractCommand(this.getCommandHandlerDeps()), handleAnalyzeCommand: () => handleAnalyzeNoteCommand(this.getCommandHandlerDeps()),
      getSkills: () => this.plugin.skillRegistry.getSkills().map(s => ({ name: s.name, description: s.description, triggers: s.triggers, alwaysActive: s.alwaysActive })),
      skillsEnabled: () => this.plugin.settings.skills.enabled, getSkillsFolderPath: () => this.plugin.settings.skills.folderPath,
    });
  }

  private buildExportHandler(deps: { app: typeof this.plugin.app; plugin: typeof this.plugin }): void {
    this.exportModule = createExportHandler(deps, { getConversation: () => this.conversation, getModel: () => this.plugin.settings.model, showStatus: (msg, type, duration) => this.showTemporaryStatus(msg, type, duration), setStatus: (msg, type) => this.setStatus(msg, type) });
  }

  private buildKeyboardHandler(container: HTMLElement, deps: { app: typeof this.plugin.app; plugin: typeof this.plugin }): void {
    this.keyboardModule = createKeyboardHandler(container, deps, {
      onNewConversation: () => this.newConversation(), onToggleSearch: () => { this.searchBarModule?.toggle(); this.searchVisible = this.searchBarModule?.isVisible() ?? false; },
      onToggleHistory: () => this.historyModule?.toggle(), onFocusInput: () => this.inputEl.focus(), onExport: () => this.exportModule?.downloadMarkdown(),
      onTogglePin: async () => { await this.plugin.storage.togglePin(this.conversation.id); this.conversation.pinned = !this.conversation.pinned; this.showTemporaryStatus(this.conversation.pinned ? 'Pinned' : 'Unpinned', 'success', 1500); },
      isSearchVisible: () => this.searchVisible, isHistoryVisible: () => this.historyModule?.isVisible() ?? false,
    });
    this.keyboardModule.register();
  }

  private getCommandHandlerDeps(): CommandHandlerDeps {
    return { app: this.plugin.app, plugin: this.plugin, getConversation: () => this.conversation, saveConversation: () => this.saveConversation(),
      renderMessage: (msg) => this.renderMessage(msg), scrollToBottom: (force) => this.scrollModule?.scrollToBottom(force),
      showTemporaryStatus: (msg, type, duration) => this.showTemporaryStatus(msg, type, duration), setStatus: (msg, type) => this.setStatus(msg, type),
      setProcessing: (processing) => this.setProcessing(processing), updateMessageContent: (id, content) => this.messageModule?.updateContent(id, content),
      updateMessageTools: (id, tools) => this.messageModule?.updateTools(id, tools), getBackend: () => this.getBackend(),
      historyRefresh: () => this.historyModule?.refresh() ?? Promise.resolve(), estimateTokens: () => this.estimateTokens(), inputValue: () => this.inputEl?.value ?? '' };
  }

  private renderMessage(msg: ChatMessage): HTMLElement | null {
    if (!this.messageModule) return null;
    const el = this.messageModule.renderMessage(msg);
    this.messageElements.set(msg.id, el);
    return el;
  }

  private renderAllMessages(): void {
    this.messageModule?.clear();
    this.messageElements.clear();
    if (this.conversation.messages.length === 0) {
      this.showWelcomeState();
    } else {
      for (const msg of this.conversation.messages) {
        const el = this.messageModule?.renderMessage(msg);
        if (el) this.messageElements.set(msg.id, el);
      }
    }
    this.scrollModule?.resetScrollState();
    this.scrollModule?.scrollToBottom(true);
    this.updateTokenCounter();
  }

  private showWelcomeState(): void {
    if (this.mobileModule?.isMobile()) { this.mobileModule.showSwipeHint(this.messagesContainer); return; }
    const w = this.messagesContainer.createDiv('desktop-welcome');
    w.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:2rem;text-align:center;color:var(--text-muted);';
    const t = w.createEl('h3', { text: 'Chat with Claude' }); t.style.cssText = 'margin:0 0 0.5rem 0;color:var(--text-normal);';
    w.createDiv().setText('Ask questions, get help with your notes, and explore your vault.');
    const h = w.createDiv(); h.style.cssText = 'font-size:0.85rem;opacity:0.7;margin-top:1rem;'; h.setText('Type a message below or use /help for commands');
  }

  private setStatus(message: string, type: 'info' | 'error' | 'success' = 'info'): void { if (!this.statusEl) return; this.statusEl.setText(message); this.statusEl.className = `chat-status status-${type}`; this.statusEl.style.display = message ? 'block' : 'none'; }
  private showTemporaryStatus(message: string, type: 'info' | 'error' | 'success' = 'info', durationMs = 3000): void { this.setStatus(message, type); setTimeout(() => this.setStatus(''), durationMs); }
  private setProcessing(processing: boolean): void { this.isProcessing = processing; this.inputModule?.setProcessing(processing); this.plugin.updateStatusBar(processing ? 'processing' : 'connected'); }
  private estimateTokens(): number { let c = this.plugin.settings.systemPrompt.length + 20; for (const m of this.conversation.messages) c += m.content.length + 20; return Math.ceil(c / CHARS_PER_TOKEN_ESTIMATE); }
  private updateTokenCounter(): void { this.statusModule?.updateTokens({ tokens: this.estimateTokens(), cost: (this.conversation?.usage ?? calculateConversationUsage(this.conversation?.messages ?? [])).totalCost }); }
  private updateContextBadge(): void { const f = this.plugin.app.workspace.getActiveFile(); this.statusModule?.updateContext(this.plugin.settings.activeNoteContext && f?.extension === 'md' ? { path: f.path, title: f.basename } : null); }
  private updateTitle(): void { if (!this.chatTitleEl) return; const t = this.conversation.title || 'New Conversation'; this.chatTitleEl.setText(t.length > 30 ? t.slice(0, 30) + '...' : t); const tab = this.tabs.find(t => t.id === this.activeTabId); if (tab) { tab.label = this.conversation.title; this.tabModule?.render(); } }

  private updateToolSummary(messageId: string, summary: string): void {
    const msgEl = this.messageElements.get(messageId); if (!msgEl) return;
    let summaryEl = msgEl.querySelector('.tool-summary-banner') as HTMLElement;
    const tc = msgEl.querySelector('.message-tools') ?? msgEl.querySelector('.message-content')?.createDiv('message-tools');
    if (!summaryEl && tc) { summaryEl = (tc as HTMLElement).createDiv('tool-summary-banner'); tc.insertBefore(summaryEl, tc.firstChild); }
    if (summaryEl) { summaryEl.empty(); const icon = summaryEl.createSpan('tool-summary-icon'); setIcon(icon, 'sparkles'); summaryEl.createSpan('tool-summary-text').setText(summary); }
  }

  private createNewConversation(): Conversation { return { id: generateId(), title: 'New Conversation', messages: [], createdAt: Date.now(), updatedAt: Date.now(), metadata: { backendType: this.plugin.backendFactory?.getBackend()?.type ?? 'api' } }; }

  private async loadConversation(): Promise<void> { try { this.conversation = await this.plugin.storage.getCurrentConversation(); this.updateTitle(); } catch (e) { log.error('Failed to load conversation', e); } }

  private async saveConversation(): Promise<void> {
    const b = this.getBackend(), sid = b.getSessionId();
    if (sid) { this.conversation.sessionId = sid; if (!this.conversation.metadata) this.conversation.metadata = { backendType: b.type }; this.conversation.metadata.sessionId = sid; }
    if (this.conversation.title === 'New Conversation' && this.conversation.messages.length >= 2) {
      const u = this.conversation.messages.find(m => m.role === 'user'), a = this.conversation.messages.find(m => m.role === 'assistant');
      if (u && a) this.generateSmartTitle(u.content, a.content); else if (u) { this.conversation.title = this.plugin.storage.generateTitle(u.content); this.updateTitle(); }
    }
    await this.plugin.storage.saveConversation(this.conversation);
  }

  private async generateSmartTitle(userMessage: string, assistantMessage: string): Promise<void> {
    const b = this.plugin.backendFactory?.getBackend();
    if (b?.generateTitle) { try { const t = await b.generateTitle(userMessage, assistantMessage); if (t && this.conversation.title === 'New Conversation') { this.conversation.title = t; this.updateTitle(); await this.plugin.storage.saveConversation(this.conversation); return; } } catch { /* fallback */ } }
    if (this.conversation.title === 'New Conversation') { this.conversation.title = this.plugin.storage.generateTitle(userMessage); this.updateTitle(); }
  }

  private async loadConversationById(id: string): Promise<void> { const c = await this.plugin.storage.loadConversation(id); if (c) { this.conversation = c; this.contextModule?.resetNoteTracking(); await this.plugin.storage.setCurrentConversationId(id); this.renderAllMessages(); this.updateTitle(); this.historyModule?.toggle(); } }
  private async duplicateConversation(id: string): Promise<void> { const c = await this.plugin.storage.duplicateConversation(id); if (c) { this.showTemporaryStatus('Duplicated', 'success', 1500); await this.historyModule?.refresh(); } else this.showTemporaryStatus('Failed to duplicate', 'error', 2000); }
  private async deleteConversation(id: string): Promise<void> { const cs = await this.plugin.storage.listConversations(); await this.plugin.storage.deleteConversation(id); if (id === this.conversation.id) { const r = cs.filter(c => c.id !== id); if (r.length > 0) await this.loadConversationById(r[0].id); else await this.newConversation(); } await this.historyModule?.refresh(); }

  public async sendMessage(message?: string): Promise<void> {
    const content = message ?? this.inputEl.value.trim();
    if (!content) return;

    if (message) this.inputEl.value = message;

    if (content.startsWith('/')) {
      const handled = await this.slashCommandsModule?.process(content);
      if (handled) { this.inputEl.value = ''; return; }
    }

    if (this.isProcessing) {
      this.queueModule?.add({ content, timestamp: Date.now() });
      this.showTemporaryStatus(`Queued (${this.queueModule?.getCount()} in queue)`, 'info', 2000);
      this.inputEl.value = '';
      return;
    }

    log.info('Sending message', { contentLength: content.length });
    this.inputModule?.addToHistory(content);
    this.inputModule?.clear();
    this.setProcessing(true);
    this.setStatus('Thinking...', 'info');

    const backend = this.getBackend();
    backend.updateSettings(this.plugin.settings);

    const currentModel = this.plugin.settings.model;
    if (this.conversation.metadata?.model && this.conversation.metadata.model !== currentModel) {
      delete this.conversation.metadata?.sessionId;
      delete this.conversation.sessionId;
      this.showTemporaryStatus(`Switched to ${currentModel}`, 'info', 2000);
    }
    if (!this.conversation.metadata) this.conversation.metadata = { backendType: backend.type };
    this.conversation.metadata.model = currentModel;

    let currentAssistantMsgId: string | null = null;
    const currentToolCalls: ToolCallInfo[] = [];

    const callbacks: AgentCallbacks = {
      onMessage: (msg) => {
        this.conversation.messages.push(msg);
        this.renderMessage(msg);
        this.updateTokenCounter();
        if (msg.role === 'assistant') currentAssistantMsgId = msg.id;
        if (msg.role === 'user') this.scrollModule?.resetScrollState();
        this.scrollModule?.scrollToBottom();
      },
      onStreamingUpdate: (id, newContent) => {
        const msg = this.conversation.messages.find(m => m.id === id);
        if (msg) { msg.content = newContent; msg.isStreaming = false; }
        this.messageModule?.updateContent(id, newContent);
      },
      onToolCall: (id, toolCall) => {
        const existing = currentToolCalls.find(t => t.name === toolCall.name);
        if (existing) Object.assign(existing, toolCall);
        else currentToolCalls.push(toolCall);
        const msg = this.conversation.messages.find(m => m.id === id);
        if (msg) msg.toolCalls = [...currentToolCalls];
        this.messageModule?.updateTools(id, currentToolCalls);
        this.setStatus(`Using tool: ${toolCall.name}`, 'info');
      },
      onToolResult: (id, toolName, result) => {
        const tool = currentToolCalls.find(t => t.name === toolName);
        if (tool) { tool.result = result; tool.status = 'completed'; }
        const msg = this.conversation.messages.find(m => m.id === id);
        if (msg) msg.toolCalls = [...currentToolCalls];
        this.messageModule?.updateTools(id, currentToolCalls);
      },
      onSessionInit: (sessionId, tools) => {
        if (!this.conversation.metadata) this.conversation.metadata = { backendType: backend.type };
        this.conversation.metadata.sessionId = sessionId;
        this.conversation.sessionId = sessionId;
        log.info('Session initialized', { sessionId, toolCount: tools.length });
      },
      onComplete: async (result) => {
        this.setProcessing(false);
        this.statusModule?.refresh();
        if (currentAssistantMsgId && (result.inputTokens || result.outputTokens)) {
          const msg = this.conversation.messages.find(m => m.id === currentAssistantMsgId);
          if (msg) {
            const inputTokens = result.inputTokens ?? 0;
            const outputTokens = result.outputTokens ?? 0;
            msg.usage = { inputTokens, outputTokens, cost: result.totalCost ?? calculateCost(inputTokens, outputTokens, this.plugin.settings.model) };
          }
          this.conversation.usage = calculateConversationUsage(this.conversation.messages);
        }
        if (result.success) { this.setStatus(''); this.updateTokenCounter(); }
        else this.setStatus(`Errors: ${result.errors?.join(', ') || 'Unknown error'}`, 'error');
        this.conversation.updatedAt = Date.now();
        await this.saveConversation();
        if ((this.queueModule?.getCount() ?? 0) > 0) setTimeout(() => this.processNextInQueue(), 500);
      },
      onError: (error) => {
        this.setProcessing(false);
        log.error('Agent error', error);
        const firstLine = (error.message || 'Unknown error').split('\n')[0].trim();
        if (firstLine.toLowerCase().includes('exited with code') || firstLine.toLowerCase().includes('session')) {
          delete this.conversation.metadata?.sessionId;
          delete this.conversation.sessionId;
          this.setStatus('Session error - try again', 'error');
          new Notice('Session ended. Please try again.', 3000);
        } else {
          this.setStatus(firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine, 'error');
        }
      },
      onSdkUuid: (id, uuid) => { const msg = this.conversation.messages.find(m => m.id === id); if (msg) msg.sdkUuid = uuid; },
      onToolSummary: (id, summary) => { const msg = this.conversation.messages.find(m => m.id === id); if (msg) { msg.toolSummary = summary; this.updateToolSummary(id, summary); } },
      onFilesPersisted: (filenames) => {
        log.info('Files modified', { count: filenames.length });
        if (this.vaultRefreshTimeout) clearTimeout(this.vaultRefreshTimeout);
        this.vaultRefreshTimeout = setTimeout(() => this.plugin.app.vault.trigger('modify'), 500);
      },
      onTaskNotification: (taskId, status, summary, outputFile) => this.handleTaskNotification(taskId, status, summary, outputFile, currentAssistantMsgId),
      onCompactionStatus: (status) => this.setStatus(status === 'compacting' ? 'Compacting context...' : '', 'info'),
      onCompactionBoundary: (trigger, preTokens) => {
        new Notice(`Context compacted: ~${Math.round(preTokens / 1000)}K tokens (${trigger})`, 3000);
        if (!this.conversation.metadata) this.conversation.metadata = {};
        if (!this.conversation.metadata.compactions) this.conversation.metadata.compactions = [];
        this.conversation.metadata.compactions.push({ timestamp: Date.now(), trigger, preTokens });
        this.saveConversation();
      },
    };

    try {
      const basePrompt = this.plugin.settings.systemPrompt;
      const enhancedPrompt = this.plugin.skillRegistry.buildSystemPrompt(basePrompt, content);
      const contextResult = await this.contextModule?.load(content);
      const messageContent = contextResult?.messageContent ?? content;
      const displayContent = contextResult?.displayContent;
      const moduleImages = this.inputModule?.getImages() ?? [];
      const images = moduleImages.length > 0 ? moduleImages.map(img => ({ data: img.data, mimeType: img.mimeType, filename: img.filename })) : undefined;
      this.inputModule?.clearImages();

      const forkFromSessionId = this.conversation.metadata?.forkFromSessionId;
      const resumeAtUuid = this.conversation.metadata?.resumeAtUuid;
      const resumeSessionId = forkFromSessionId || this.conversation.metadata?.sessionId || this.conversation.sessionId;

      await backend.sendMessage(messageContent, this.conversation, callbacks, {
        resumeSessionId,
        forkSession: !!forkFromSessionId,
        resumeSessionAt: resumeAtUuid,
        systemPrompt: enhancedPrompt,
        displayContent,
        images,
      });

      if ((forkFromSessionId || resumeAtUuid) && this.conversation.metadata) {
        delete this.conversation.metadata.forkFromSessionId;
        delete this.conversation.metadata.resumeAtUuid;
        await this.plugin.storage.saveConversation(this.conversation);
      }
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private stopGeneration(): void {
    if (this.messageOrchestrator) this.messageOrchestrator.stop();
    else { this.getBackend().abort(); this.setProcessing(false); this.setStatus('Stopped', 'info'); }
  }

  private async processNextInQueue(): Promise<void> {
    if (!this.queueModule || this.isProcessing) return;
    const nextMessage = this.queueModule.getNext();
    if (nextMessage) { this.inputEl.value = nextMessage.content; await this.sendMessage(); }
  }

  private async buildContextInfo(): Promise<ContextInfo> {
    const basePrompt = this.plugin.settings.systemPrompt;
    const enhancedPrompt = this.plugin.skillRegistry.buildSystemPrompt(basePrompt, this.inputEl?.value ?? '');
    const contextInfo: ContextInfo = { systemPrompt: enhancedPrompt };
    if (this.contextModule) {
      const result = await this.contextModule.load('');
      if (result.messageContent !== '') {
        const selectedTextMatch = result.messageContent.match(/<selected_text path="([^"]+)" lines="(\d+)-(\d+)">\n([\s\S]*?)\n<\/selected_text>/);
        if (selectedTextMatch) contextInfo.selectedText = { path: selectedTextMatch[1], startLine: parseInt(selectedTextMatch[2], 10), endLine: parseInt(selectedTextMatch[3], 10), text: selectedTextMatch[4] };
        const activeNoteMatch = result.messageContent.match(/<active_note path="([^"]+)">\n([\s\S]*?)\n<\/active_note>/);
        if (activeNoteMatch) contextInfo.activeNote = { path: activeNoteMatch[1], content: activeNoteMatch[2], isDelta: false };
        const deltaMatch = result.messageContent.match(/<active_note_changes path="([^"]+)">\n([\s\S]*?)\n<\/active_note_changes>/);
        if (deltaMatch) contextInfo.activeNote = { path: deltaMatch[1], content: deltaMatch[2], isDelta: true };
      }
    }
    return contextInfo;
  }

  private handleInputKeyDown(e: KeyboardEvent): boolean {
    if (this.autocompleteModule?.isVisible()) {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.autocompleteModule.navigate('down'); return true; }
      if (e.key === 'ArrowUp') { e.preventDefault(); this.autocompleteModule.navigate('up'); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this.autocompleteModule.select(); return true; }
      if (e.key === 'Escape') { e.preventDefault(); this.autocompleteModule.hide(); return true; }
    }
    if (e.key === 'Escape') this.autocompleteModule?.hide(); return false;
  }

  private handleRegenerate(messageId: string): void { const i = this.conversation.messages.findIndex(m => m.id === messageId); if (i > 0) { const u = this.conversation.messages[i - 1]; if (u.role === 'user') { this.conversation.messages = this.conversation.messages.slice(0, i); this.renderAllMessages(); this.inputEl.value = u.content; } } }
  private async toggleBookmark(messageId: string): Promise<void> { const m = this.conversation.messages.find(m => m.id === messageId); if (!m) return; m.bookmarked = !m.bookmarked; this.messageModule?.updateBookmarkState(messageId, m.bookmarked); this.messageModule?.updateActions(messageId, m); await this.saveConversation(); }
  private async toggleReaction(messageId: string, reaction: 'up' | 'down'): Promise<void> { const m = this.conversation.messages.find(m => m.id === messageId); if (!m) return; m.reaction = m.reaction === reaction ? null : reaction; this.messageModule?.updateActions(messageId, m); await this.saveConversation(); }

  private async resumeFromMessage(msg: ChatMessage): Promise<void> {
    if (!msg.sdkUuid) { this.showTemporaryStatus('Cannot resume: no SDK UUID', 'error', 3000); return; }
    const sid = this.conversation.metadata?.sessionId; if (!sid) { this.showTemporaryStatus('Cannot resume: no session ID', 'error', 3000); return; }
    const nc = await this.plugin.storage.duplicateConversation(this.conversation.id); if (!nc) { this.showTemporaryStatus('Failed to create fork', 'error', 3000); return; }
    const i = this.conversation.messages.findIndex(m => m.id === msg.id); if (i >= 0) nc.messages = this.conversation.messages.slice(0, i + 1);
    if (!nc.metadata) nc.metadata = { backendType: 'sdk' }; nc.metadata.resumeAtUuid = msg.sdkUuid; nc.metadata.forkFromSessionId = sid; nc.title = `${this.conversation.title} (from checkpoint)`;
    await this.plugin.storage.saveConversation(nc); this.conversation = nc; await this.plugin.storage.setCurrentConversationId(nc.id); this.renderAllMessages(); this.updateTitle(); this.showTemporaryStatus('Resumed from checkpoint', 'success', 3000);
  }

  private handleTaskNotification(taskId: string, status: 'completed' | 'failed' | 'stopped', summary: string, outputFile: string, assistantMsgId: string | null): void {
    const icons: Record<string, string> = { completed: '[Done]', failed: '[Failed]', stopped: '[Stopped]' };
    new Notice(`${icons[status] || ''} Task ${taskId.slice(0, 8)}: ${summary.slice(0, 50)}${summary.length > 50 ? '...' : ''}`, status === 'failed' ? 5000 : 3000);
    if (!assistantMsgId) return; const el = this.messageElements.get(assistantMsgId); if (!el) return;
    const tc = el.querySelector('.message-tools') ?? el.querySelector('.message-content')?.createDiv('message-tools'); if (!tc) return;
    const n = (tc as HTMLElement).createDiv('task-notification-banner'); n.addClass(`task-status-${status}`);
    n.createSpan('task-notification-icon').setText(icons[status] || ''); n.createSpan('task-notification-text').setText(`Task ${taskId.slice(0, 8)}: ${summary}`);
    if (outputFile && status === 'completed') n.createEl('a', { cls: 'task-output-link', text: ' (view output)' }).addEventListener('click', () => new Notice(`Output: ${outputFile}`, 5000));
  }

  private handleRenamePrompt(): void { promptRenameConversation(this.conversation.id, this.conversation.title, this.getCommandHandlerDeps(), (t) => { this.conversation.title = t; this.updateTitle(); }); }
  private handleManageTags(id: string, tags: string[]): void { promptManageTags(id, tags, this.getCommandHandlerDeps(), (t) => { if (this.conversation.id === id) this.conversation.tags = t; }); }

  private showHeaderMenu(e: MouseEvent): void {
    const m = new Menu();
    m.addItem(i => i.setTitle('Search messages').setIcon('search').onClick(() => { this.searchBarModule?.toggle(); this.searchVisible = this.searchBarModule?.isVisible() ?? false; }));
    m.addSeparator(); m.addItem(i => i.setTitle('Export as note').setIcon('file-down').onClick(() => this.exportModule?.downloadMarkdown()));
    m.addItem(i => i.setTitle('Copy to clipboard').setIcon('clipboard-copy').onClick(() => this.exportModule?.copyToClipboard()));
    m.addSeparator(); m.addItem(i => i.setTitle('Rename conversation').setIcon('pencil').onClick(() => this.handleRenamePrompt()));
    m.addItem(i => i.setTitle('Clear messages').setIcon('trash-2').onClick(() => this.clearMessages())); m.showAtMouseEvent(e);
  }

  private initializeTabs(): void { const st = this.plugin.settings.savedTabs as ChatTab[] | undefined, sa = this.plugin.settings.activeTabId as string | undefined; if (st && st.length > 0) { this.tabs = st; this.activeTabId = sa || st[0].id; } else { const t: ChatTab = { id: generateId(), conversationId: this.conversation?.id || '', label: this.conversation?.title || 'New Chat' }; this.tabs = [t]; this.activeTabId = t.id; } }

  private async switchToTab(tabId: string): Promise<void> {
    if (tabId === this.activeTabId) return; const t = this.tabs.find(t => t.id === tabId); if (!t) return;
    await this.saveConversation(); this.activeTabId = tabId;
    const cs = await this.plugin.conversationStore.list(), c = cs.find(c => c.id === t.conversationId);
    if (c) this.conversation = c; else { this.conversation = { id: t.conversationId || generateId(), title: 'New Chat', messages: [], createdAt: Date.now(), updatedAt: Date.now() }; t.conversationId = this.conversation.id; }
    this.renderAllMessages(); this.updateTitle(); this.tabModule?.setVisible(this.tabs.length > 1); await this.saveTabState();
  }

  private async createNewTab(): Promise<void> {
    await this.saveConversation(); const nc: Conversation = { id: generateId(), title: 'New Chat', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    const nt: ChatTab = { id: generateId(), conversationId: nc.id, label: 'New Chat' }; this.tabs.push(nt); this.activeTabId = nt.id; this.conversation = nc;
    this.renderAllMessages(); this.updateTitle(); this.tabModule?.setVisible(this.tabs.length > 1); await this.saveTabState(); this.inputEl.focus();
  }

  private async closeTab(tabId: string): Promise<void> { if (this.tabs.length <= 1) return; const i = this.tabs.findIndex(t => t.id === tabId); if (i === -1) return; this.tabs.splice(i, 1); if (tabId === this.activeTabId) await this.switchToTab(this.tabs[Math.min(i, this.tabs.length - 1)].id); else { this.tabModule?.setVisible(this.tabs.length > 1); await this.saveTabState(); } }
  private async saveTabState(): Promise<void> { const t = this.tabs.find(t => t.id === this.activeTabId); if (t && this.conversation) { t.label = this.conversation.title; t.conversationId = this.conversation.id; } (this.plugin.settings as Record<string, unknown>).savedTabs = this.tabs; (this.plugin.settings as Record<string, unknown>).activeTabId = this.activeTabId; await this.plugin.saveSettings(); }

  private setupHookCallbacks(): void {
    this.plugin.backendFactory?.setHookCallbacks({
      onVaultRefresh: () => log.debug('Hook triggered vault refresh'),
      onNotification: (title, message, type) => { log.debug('Hook notification', { title, message, type }); new Notice(`${title}: ${message}`, type === 'error' ? 5000 : 3000); },
      onToolBlocked: (toolName, reason) => { log.warn('Hook blocked tool', { toolName, reason }); new Notice(`Blocked: ${toolName} - ${reason}`, 3000); },
      onAuditLog: (toolName, input, output) => log.info('Tool audit', { tool: toolName, inputPreview: JSON.stringify(input).slice(0, 100), outputPreview: JSON.stringify(output).slice(0, 100) }),
      onPermissionRequest: async (ctx: PermissionRequestContext): Promise<PermissionResponse> => { log.info('Permission request', { toolName: ctx.toolName, toolUseID: ctx.toolUseID }); return new Promise<PermissionResponse>(r => { let d = false; const s = (res: PermissionResponse) => { if (!d) { d = true; r(res); } }; new PermissionModal(this.plugin.app, ctx, s).open(); }); },
    });
  }

  private createCommandContext(): ChatViewCommandContext {
    return { plugin: this.plugin, conversation: this.conversation, inputEl: this.inputEl, messagesContainer: this.messagesContainer,
      getMessageQueue: () => [], isSearchVisible: () => this.searchVisible,
      showTemporaryStatus: (msg, type, duration) => this.showTemporaryStatus(msg, type, duration), setStatus: (msg, type) => this.setStatus(msg, type),
      renderAllMessages: () => this.renderAllMessages(), scrollToBottom: (force) => this.scrollModule?.scrollToBottom(force),
      clearMessages: () => this.clearMessages(), newConversation: () => this.newConversation(),
      toggleSearch: () => { this.searchBarModule?.toggle(); this.searchVisible = this.searchBarModule?.isVisible() ?? false; },
      clearQueue: () => this.queueModule?.clear(), performSearch: (q) => { this.searchBarModule?.show(); this.searchBarModule?.search(q); },
      addTagToConversation: async (tag) => { const ts = this.conversation.tags || []; if (!ts.includes(tag)) { ts.push(tag); this.conversation.tags = ts; await this.plugin.storage.updateTags(this.conversation.id, ts); this.showTemporaryStatus(`Tag "${tag}" added`, 'success', 1500); } },
      removeTagFromConversation: async (tag) => { const ts = this.conversation.tags || [], i = ts.indexOf(tag); if (i >= 0) { ts.splice(i, 1); this.conversation.tags = ts; await this.plugin.storage.updateTags(this.conversation.id, ts); this.showTemporaryStatus(`Tag "${tag}" removed`, 'success', 1500); } },
      saveConversation: () => this.saveConversation(),
      exportConversation: () => this.exportModule?.downloadMarkdown() ?? Promise.resolve(),
      exportToClipboard: () => this.exportModule?.copyToClipboard() ?? Promise.resolve(),
      exportToJson: () => this.exportModule?.downloadJSON() ?? Promise.resolve(),
      resizeInput: () => this.inputModule?.resize(),
      focusInput: () => this.inputModule?.focus(),
    };
  }

  focusInput(): void { this.inputEl?.focus(); }
  async newConversation(): Promise<void> {
    log.info('Creating new conversation');
    this.conversation = await this.plugin.storage.createConversation();
    this.contextModule?.resetNoteTracking();
    this.renderAllMessages();
    this.updateTitle();
    this.setStatus('');
    if (this.historyModule?.isVisible()) this.historyModule.hide();
    this.inputEl.focus();
  }
  async clearMessages(): Promise<void> {
    log.info('Clearing messages', { conversationId: this.conversation.id });
    this.conversation.messages = [];
    this.conversation.sessionId = undefined;
    this.renderAllMessages();
    await this.saveConversation();
    this.showTemporaryStatus('Messages cleared', 'info', 2000);
  }
  stopResponse(): void { if (this.isProcessing) this.stopGeneration(); }
  async copyLastResponse(): Promise<void> {
    const lastAssistantMsg = [...this.conversation.messages].reverse().find(m => m.role === 'assistant');
    if (lastAssistantMsg) { await navigator.clipboard.writeText(lastAssistantMsg.content); new Notice('Copied to clipboard'); }
    else new Notice('No assistant response to copy');
  }
  async toggleHistory(): Promise<void> { await this.historyModule?.toggle(); }
  toggleSearch(): void { this.searchBarModule?.toggle(); this.searchVisible = this.searchBarModule?.isVisible() ?? false; }

  async onClose(): Promise<void> {
    log.info('Closing chat view');
    this.searchBarModule?.destroy();
    this.queueModule?.destroy();
    this.statusModule?.destroy();
    this.mobileModule?.destroy();
    this.tabModule?.destroy();
    this.messageModule?.destroy();
    this.inputModule?.destroy();
    this.historyModule?.destroy();
    this.keyboardModule?.destroy();
    this.exportModule?.destroy();
    await this.saveTabState();
    await this.saveConversation();
  }
}
