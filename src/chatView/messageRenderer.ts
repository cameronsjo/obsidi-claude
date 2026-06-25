/**
 * Message renderer module for ChatView.
 * Handles message display, tool calls, markdown rendering, and message actions.
 */
import { setIcon, MarkdownRenderer, Component } from 'obsidian';
import type { ModuleDeps, ModuleHandle, ChatMessage, ToolCallInfo } from './types';

/** Tool status to icon mapping */
const TOOL_STATUS_ICONS: Record<ToolCallInfo['status'], string> = {
  completed: 'check-circle',
  running: 'loader',
  error: 'x-circle',
  pending: 'circle',
};

export interface MessageRendererCallbacks {
  onCopy: (messageId: string) => void;
  onRegenerate: (messageId: string) => void;
  onEdit: (messageId: string) => void;
  onReact: (messageId: string, reaction: string) => void;
  onBookmark: (messageId: string) => void;
  onResume: (messageId: string) => void;
  scrollToBottom: () => void;
  /** Check if resume button should be shown for a message */
  canResume: (message: ChatMessage) => boolean;
}

export interface MessageRendererHandle extends ModuleHandle {
  /** Render a message to the container */
  renderMessage(message: ChatMessage): HTMLElement;
  /** Update message content (for streaming updates) */
  updateContent(messageId: string, content: string): void;
  /** Update tool calls for a message */
  updateTools(messageId: string, toolCalls: ToolCallInfo[]): void;
  /** Get a message element by ID */
  getMessageElement(messageId: string): HTMLElement | null;
  /** Clear all messages from the container */
  clear(): void;
  /** Show welcome state element */
  showWelcome(welcomeEl: HTMLElement): void;
  /** Add copy buttons to code blocks in the container */
  addCodeBlockCopyButtons(): void;
  /** Update message actions (e.g., after bookmark/reaction toggle) */
  updateActions(messageId: string, message: ChatMessage): void;
  /** Update bookmark state on a message */
  updateBookmarkState(messageId: string, bookmarked: boolean): void;
  /**
   * Render an inline permission-prompt card into a message. Returns false if the
   * target message element is not present (caller should fall back to the modal).
   */
  renderPermissionCard(
    messageId: string,
    command: string,
    title: string,
    onDecision: (decision: 'once' | 'always' | 'deny') => void
  ): boolean;
}

export function createMessageRenderer(
  container: HTMLElement,
  deps: ModuleDeps,
  callbacks: MessageRendererCallbacks
): MessageRendererHandle {
  const messageElements = new Map<string, HTMLElement>();
  const renderComponents = new Map<string, Component>();

  function renderMessage(message: ChatMessage): HTMLElement {
    const msgDiv = container.createDiv('chat-message');
    msgDiv.addClass(message.role === 'user' ? 'user-message' : 'assistant-message');
    if (message.bookmarked) {
      msgDiv.addClass('message-bookmarked');
    }
    msgDiv.dataset.messageId = message.id;

    // Message header (avatar + role + time) - outside the bubble
    const headerDiv = msgDiv.createDiv('message-header');

    // Avatar: round user glyph, or accent square + rotated diamond for Claude.
    const avatar = headerDiv.createSpan('message-avatar');
    if (message.role === 'user') {
      avatar.addClass('message-avatar-user');
      setIcon(avatar, 'user');
    } else {
      // Claude avatar is drawn purely in CSS (square + diamond), no icon.
      avatar.addClass('message-avatar-claude');
    }

    const roleLabel = headerDiv.createSpan('message-role');
    roleLabel.textContent = message.role === 'user' ? 'You' : 'Claude';
    const timeEl = headerDiv.createSpan('message-time');
    timeEl.textContent = new Date(message.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    // Message bubble
    const bubbleDiv = msgDiv.createDiv('message-bubble');

    // Thinking block (above tools), default per the "Show thinking" setting.
    if (message.thinking) {
      renderThinking(bubbleDiv, message.thinking, deps.plugin.settings.showThinkingByDefault);
    }

    // Tool calls FIRST (shown above content, like Claude Code)
    if (
      message.toolCalls &&
      message.toolCalls.length > 0 &&
      deps.plugin.settings.showToolCalls
    ) {
      const toolsDiv = bubbleDiv.createDiv('message-tools');
      renderToolCalls(toolsDiv, message.toolCalls);
    }

    // Content inside bubble (after tools)
    const contentDiv = bubbleDiv.createDiv('message-content');

    // Render images if present
    if (message.images && message.images.length > 0) {
      const imagesDiv = contentDiv.createDiv('message-images');
      for (const img of message.images) {
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

    if (message.content) {
      // Create a component for the markdown renderer
      const component = new Component();
      component.load();
      renderComponents.set(message.id, component);

      MarkdownRenderer.render(
        deps.app,
        message.content,
        contentDiv,
        deps.app.workspace.getActiveFile()?.path ?? '',
        component
      );
      // Add copy buttons to code blocks
      addCodeBlockCopyButtonsToElement(contentDiv);
    } else if (message.isStreaming) {
      contentDiv.createDiv('typing-indicator');
    }

    // Message action buttons (optional, hidden during streaming)
    if (deps.plugin.settings.showMessageActions) {
      const actionsDiv = msgDiv.createDiv('message-actions');
      if (message.isStreaming) {
        actionsDiv.style.display = 'none';
      }
      createMessageActions(actionsDiv, message);
    }

    messageElements.set(message.id, msgDiv);
    return msgDiv;
  }

  // ===== Tool-call card vocabulary (handoff Phase 3) =====
  //
  // A single generic card is replaced by a tool-name → card-type dispatch.
  // Card types: plan/todo, search, web-fetch, file-edit diff, plus a quiet
  // (non-card) aggregated read line and a generic fallback. The permission
  // prompt is rendered inline by renderPermissionCard (wired from the backend
  // hook), keeping the modal as a fallback.

  type CardType = 'plan' | 'search' | 'read' | 'fetch' | 'diff' | 'generic';

  function classifyTool(name: string): CardType {
    const n = name.toLowerCase();
    if (n === 'todowrite') return 'plan';
    if (n === 'webfetch' || n === 'web_fetch' || n === 'fetch') return 'fetch';
    if (['read', 'read_note', 'open_note', 'file_metadata'].includes(n)) return 'read';
    if (['edit', 'multiedit', 'write', 'create_note', 'append_to_note'].includes(n)) return 'diff';
    if (n === 'grep' || n === 'glob' || n.includes('search')) return 'search';
    return 'generic';
  }

  interface CardShellOpts {
    icon: string;
    iconClass?: string;
    title: string;
    titleMeta?: string;
    query?: string;
    queryClass?: string;
    trailing?: string;
    defaultOpen: boolean;
    cardClass?: string;
    status?: ToolCallInfo['status'];
  }

  /** Bordered, collapsible card shell shared by plan/search/fetch/diff/generic. */
  function createCardShell(
    parent: HTMLElement,
    opts: CardShellOpts
  ): { card: HTMLElement; header: HTMLElement; body: HTMLElement } {
    const card = parent.createDiv('occ-card');
    if (opts.cardClass) card.addClass(opts.cardClass);
    if (opts.status) card.addClass(`occ-card-status-${opts.status}`);

    const header = card.createDiv('occ-card-header');
    header.setAttribute('aria-label', 'Toggle details');
    const chevron = header.createSpan('occ-card-chevron');
    setIcon(chevron, 'chevron-right');
    const icon = header.createSpan('occ-card-icon');
    if (opts.iconClass) icon.addClass(opts.iconClass);
    setIcon(icon, opts.icon);
    header.createSpan({ cls: 'occ-card-title', text: opts.title });
    if (opts.titleMeta) header.createSpan({ cls: 'occ-card-meta', text: opts.titleMeta });
    if (opts.query) {
      const q = header.createSpan({ cls: 'occ-card-query', text: opts.query });
      if (opts.queryClass) q.addClass(opts.queryClass);
    }
    if (opts.trailing) header.createSpan({ cls: 'occ-card-trailing', text: opts.trailing });

    const body = card.createDiv('occ-card-body');
    const setOpen = (open: boolean): void => {
      card.toggleClass('is-open', open);
      body.style.display = open ? '' : 'none';
    };
    setOpen(opts.defaultOpen);
    header.onclick = (e): void => {
      e.stopPropagation();
      setOpen(!card.hasClass('is-open'));
    };

    return { card, header, body };
  }

  /** Render freeform tool result text (or a working state) into a card body. */
  function renderResultBody(body: HTMLElement, tool: ToolCallInfo): void {
    if (!tool.result) {
      if (tool.status === 'running' || tool.status === 'pending') {
        body.createDiv({ cls: 'occ-card-running', text: 'Working…' });
      }
      return;
    }
    const text = tool.result.length > 4000 ? tool.result.slice(0, 4000) + '\n…' : tool.result;
    body.createEl('pre', { cls: 'occ-card-pre' }).textContent = text;
  }

  function extractTodos(input: Record<string, unknown>): { content: string; status: string }[] {
    const raw = (input?.todos ?? input?.items) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        const o = (item ?? {}) as Record<string, unknown>;
        return {
          content: String(o.content ?? o.activeForm ?? o.title ?? ''),
          status: String(o.status ?? 'pending'),
        };
      })
      .filter((t) => t.content);
  }

  function renderPlanCard(parent: HTMLElement, tool: ToolCallInfo): void {
    const todos = extractTodos(tool.input);
    const done = todos.filter((t) => t.status === 'completed').length;
    const { body } = createCardShell(parent, {
      icon: 'list-checks',
      title: 'Plan',
      titleMeta: todos.length ? `· ${done} of ${todos.length} done` : undefined,
      defaultOpen: true,
      cardClass: 'occ-card-plan',
      status: tool.status,
    });
    if (!todos.length) {
      body.createDiv({ cls: 'occ-card-running', text: 'No tasks' });
      return;
    }
    for (const t of todos) {
      const isDone = t.status === 'completed';
      const isActive = t.status === 'in_progress';
      const row = body.createDiv('occ-plan-row');
      const mark = row.createSpan('occ-plan-mark');
      setIcon(mark, isDone ? 'check' : isActive ? 'loader' : 'circle');
      if (isDone) mark.addClass('is-done');
      if (isActive) mark.addClass('is-active');
      const label = row.createSpan({ cls: 'occ-plan-label', text: t.content });
      if (isDone) label.addClass('is-done');
    }
  }

  function renderSearchCard(parent: HTMLElement, tool: ToolCallInfo): void {
    const input = tool.input as Record<string, unknown>;
    const query = String(input.query ?? input.pattern ?? input.q ?? '');
    const count = tool.result ? tool.result.split('\n').filter((l) => l.trim()).length : 0;
    const { body } = createCardShell(parent, {
      icon: 'search',
      title: 'Searched vault',
      query: query ? `"${query}"` : undefined,
      trailing: tool.result ? `${count} ${count === 1 ? 'result' : 'results'}` : undefined,
      defaultOpen: false,
      cardClass: 'occ-card-search',
      status: tool.status,
    });
    renderResultBody(body, tool);
  }

  function renderFetchCard(parent: HTMLElement, tool: ToolCallInfo): void {
    const url = String((tool.input as Record<string, unknown>).url ?? '');
    let domain = url;
    try {
      domain = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      /* leave raw url */
    }
    const { body } = createCardShell(parent, {
      icon: 'globe',
      title: 'Fetched',
      query: domain || undefined,
      queryClass: 'is-accent',
      defaultOpen: false,
      cardClass: 'occ-card-fetch',
      status: tool.status,
    });
    renderResultBody(body, tool);
  }

  interface DiffLine {
    sign: '+' | '-';
    text: string;
  }

  function computeDiff(tool: ToolCallInfo): { additions: number; deletions: number; lines: DiffLine[] } {
    const input = tool.input as Record<string, unknown>;
    const oldStr = input.old_string ?? input.oldString;
    const newStr = input.new_string ?? input.newString;
    const content = input.content ?? input.text ?? input.data;
    const lines: DiffLine[] = [];
    let additions = 0;
    let deletions = 0;
    if (typeof oldStr === 'string' || typeof newStr === 'string') {
      if (typeof oldStr === 'string' && oldStr.length) {
        for (const l of oldStr.split('\n')) {
          lines.push({ sign: '-', text: l });
          deletions++;
        }
      }
      if (typeof newStr === 'string' && newStr.length) {
        for (const l of newStr.split('\n')) {
          lines.push({ sign: '+', text: l });
          additions++;
        }
      }
    } else if (typeof content === 'string') {
      for (const l of content.split('\n')) {
        lines.push({ sign: '+', text: l });
        additions++;
      }
    }
    return { additions, deletions, lines };
  }

  function renderDiffCard(parent: HTMLElement, tool: ToolCallInfo): void {
    const input = tool.input as Record<string, unknown>;
    const path = String(input.path ?? input.file_path ?? input.filename ?? '');
    const filename = path.split('/').pop() || path || 'file';
    const isCreate = ['create_note', 'write'].includes(tool.name.toLowerCase());
    const { additions, deletions, lines } = computeDiff(tool);

    const { header, body } = createCardShell(parent, {
      icon: 'file-pen-line',
      iconClass: 'is-green',
      title: filename,
      defaultOpen: true,
      cardClass: 'occ-card-diff',
      status: tool.status,
    });

    // NEW badge + +/- stats appended to the header.
    if (isCreate) header.createSpan({ cls: 'occ-badge-new', text: 'NEW' });
    const stats = header.createSpan('occ-diff-stats');
    stats.createSpan({ cls: 'occ-diff-add', text: `+${additions}` });
    stats.createSpan({ cls: 'occ-diff-del', text: `−${deletions}` });

    if (!lines.length) {
      renderResultBody(body, tool);
      return;
    }
    const MAX_DIFF_LINES = 120;
    for (const dl of lines.slice(0, MAX_DIFF_LINES)) {
      const row = body.createDiv('occ-diff-row');
      row.addClass(dl.sign === '+' ? 'is-add' : 'is-del');
      row.createSpan({ cls: 'occ-diff-gutter', text: dl.sign });
      row.createSpan({ cls: 'occ-diff-code', text: dl.text });
    }
    if (lines.length > MAX_DIFF_LINES) {
      body.createDiv({ cls: 'occ-card-running', text: `… ${lines.length - MAX_DIFF_LINES} more lines` });
    }
  }

  /** Quiet, non-card aggregated line for file reads. */
  function renderQuietReadLine(parent: HTMLElement, reads: ToolCallInfo[]): void {
    const names = reads
      .map((t) => {
        const i = t.input as Record<string, unknown>;
        const p = String(i.path ?? i.file_path ?? i.filename ?? '');
        return p.split('/').pop() || p;
      })
      .filter(Boolean);
    const n = reads.length;
    const row = parent.createDiv('occ-read-line');
    const icon = row.createSpan('occ-read-icon');
    setIcon(icon, 'file-text');
    row.createSpan({ cls: 'occ-read-text', text: `Read ${n === 1 ? '1 note' : `${n} notes`}` });
    if (names.length) {
      row.createSpan({ cls: 'occ-read-files', text: ` · ${names.join(', ')}` });
    }
  }

  function genericToolIcon(name: string): string {
    const n = name.toLowerCase();
    if (n === 'bash' || n.includes('command') || n.includes('terminal')) return 'terminal';
    if (n.includes('list') || n.includes('structure') || n.includes('vault')) return 'folder';
    return 'wrench';
  }

  function renderGenericCard(parent: HTMLElement, tool: ToolCallInfo): void {
    const { body } = createCardShell(parent, {
      icon: genericToolIcon(tool.name),
      iconClass: `occ-card-icon-${tool.status}`,
      title: tool.name,
      query: getToolSummary(tool) || undefined,
      defaultOpen: false,
      cardClass: 'occ-card-generic',
      status: tool.status,
    });
    if (tool.input && Object.keys(tool.input).length > 0) {
      const sec = body.createDiv('occ-card-section');
      sec.createDiv({ cls: 'occ-card-section-label', text: 'Input' });
      sec.createEl('pre', { cls: 'occ-card-pre' }).textContent = JSON.stringify(tool.input, null, 2);
    }
    if (tool.result) {
      const sec = body.createDiv('occ-card-section');
      sec.createDiv({ cls: 'occ-card-section-label', text: tool.status === 'error' ? 'Error' : 'Result' });
      sec.createEl('pre', { cls: 'occ-card-pre' }).textContent = tool.result;
    }
  }

  /** Dispatch a list of tool calls to their card treatments (reads aggregated). */
  function renderToolCalls(parent: HTMLElement, toolCalls: ToolCallInfo[]): void {
    const reads = toolCalls.filter((t) => classifyTool(t.name) === 'read');
    let readsRendered = false;
    for (const tool of toolCalls) {
      switch (classifyTool(tool.name)) {
        case 'read':
          if (!readsRendered) {
            renderQuietReadLine(parent, reads);
            readsRendered = true;
          }
          break;
        case 'plan':
          renderPlanCard(parent, tool);
          break;
        case 'search':
          renderSearchCard(parent, tool);
          break;
        case 'fetch':
          renderFetchCard(parent, tool);
          break;
        case 'diff':
          renderDiffCard(parent, tool);
          break;
        default:
          renderGenericCard(parent, tool);
          break;
      }
    }
  }

  /** Collapsible thinking block: toggle row + left-ruled italic paragraph. */
  function renderThinking(parent: HTMLElement, text: string, defaultOpen: boolean): void {
    const wrap = parent.createDiv('occ-think');
    const header = wrap.createDiv('occ-think-header');
    const chevron = header.createSpan('occ-think-chevron');
    setIcon(chevron, 'chevron-right');
    header.createSpan('occ-think-dot');
    header.createSpan({ cls: 'occ-think-label', text: 'Thought process' });
    const body = wrap.createDiv('occ-think-body');
    body.createDiv({ cls: 'occ-think-text', text });
    const setOpen = (open: boolean): void => {
      wrap.toggleClass('is-open', open);
      body.style.display = open ? '' : 'none';
    };
    setOpen(defaultOpen);
    header.onclick = (e): void => {
      e.stopPropagation();
      setOpen(!wrap.hasClass('is-open'));
    };
  }

  function getToolSummary(tool: ToolCallInfo): string {
    const input = tool.input as Record<string, unknown>;

    switch (tool.name) {
      case 'semantic_search':
      case 'search_content':
      case 'grep':
      case 'glob':
        return input.query || input.pattern ? `"${String(input.query ?? input.pattern).slice(0, 30)}"` : '';
      case 'create_note':
      case 'append_to_note':
      case 'rename_note':
      case 'open_note':
      case 'edit':
      case 'write':
        return input.path || input.file_path
          ? String(input.path ?? input.file_path).split('/').pop() || ''
          : '';
      case 'webfetch':
      case 'web_fetch':
        return input.url ? String(input.url) : '';
      case 'vault_structure':
        return input.path ? String(input.path) : 'root';
      case 'file_metadata':
      case 'backlinks':
      case 'outgoing_links':
        return input.path ? String(input.path).split('/').pop() || '' : '';
      default:
        for (const val of Object.values(input)) {
          if (typeof val === 'string' && val.length > 0) {
            return val.length > 30 ? val.slice(0, 30) + '...' : val;
          }
        }
        return '';
    }
  }

  /**
   * Render an inline permission-prompt card into a message element and resolve
   * via the supplied callback. Mirrors the modal's Allow once / Always / Deny.
   */
  function renderPermissionCard(
    messageId: string,
    command: string,
    title: string,
    onDecision: (decision: 'once' | 'always' | 'deny') => void
  ): boolean {
    const msgEl = messageElements.get(messageId);
    if (!msgEl) return false;
    const bubble = (msgEl.querySelector('.message-bubble') as HTMLElement) ?? msgEl;
    let tools = bubble.querySelector('.message-tools') as HTMLElement | null;
    if (!tools) {
      tools = bubble.createDiv('message-tools');
      const content = bubble.querySelector('.message-content');
      if (content) bubble.insertBefore(tools, content);
    }

    const card = tools.createDiv('occ-card occ-card-permission is-open');
    const header = card.createDiv('occ-card-header');
    const icon = header.createSpan('occ-card-icon is-yellow');
    setIcon(icon, 'terminal');
    header.createSpan({ cls: 'occ-card-title', text: title });

    const cmdBox = card.createEl('pre', { cls: 'occ-permission-cmd' });
    cmdBox.textContent = command;

    const actions = card.createDiv('occ-permission-actions');
    const decide = (decision: 'once' | 'always' | 'deny'): void => {
      card.addClass('is-resolved');
      actions.empty();
      actions.createSpan({
        cls: 'occ-permission-result',
        text: decision === 'deny' ? 'Denied' : decision === 'always' ? 'Always allowed' : 'Allowed once',
      });
      onDecision(decision);
    };
    const allowOnce = actions.createEl('button', { cls: 'occ-perm-btn occ-perm-allow', text: 'Allow once' });
    allowOnce.onclick = (): void => decide('once');
    const always = actions.createEl('button', { cls: 'occ-perm-btn occ-perm-always', text: 'Always' });
    always.onclick = (): void => decide('always');
    actions.createDiv('composer-spacer');
    const deny = actions.createEl('button', { cls: 'occ-perm-btn occ-perm-deny', text: 'Deny' });
    deny.onclick = (): void => decide('deny');

    callbacks.scrollToBottom();
    return true;
  }

  function createMessageActions(actionsContainer: HTMLElement, msg: ChatMessage): void {
    // Bookmark button
    const bookmarkBtn = actionsContainer.createEl('button', {
      cls: `message-action-btn bookmark-btn ${msg.bookmarked ? 'bookmark-active' : ''}`,
      attr: { 'aria-label': msg.bookmarked ? 'Remove bookmark' : 'Bookmark message' },
    });
    setIcon(bookmarkBtn, msg.bookmarked ? 'bookmark-check' : 'bookmark');
    bookmarkBtn.onclick = (e) => {
      e.stopPropagation();
      callbacks.onBookmark(msg.id);
    };

    // Copy button
    const copyBtn = actionsContainer.createEl('button', {
      cls: 'message-action-btn',
      attr: { 'aria-label': 'Copy message' },
    });
    setIcon(copyBtn, 'copy');
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      callbacks.onCopy(msg.id);
    };

    // Only show regenerate and reactions for assistant messages
    if (msg.role === 'assistant') {
      // Thumbs up reaction
      const thumbsUpBtn = actionsContainer.createEl('button', {
        cls: `message-action-btn reaction-btn ${msg.reaction === 'up' ? 'reaction-active' : ''}`,
        attr: { 'aria-label': 'Good response' },
      });
      setIcon(thumbsUpBtn, 'thumbs-up');
      thumbsUpBtn.onclick = (e) => {
        e.stopPropagation();
        callbacks.onReact(msg.id, 'up');
      };

      // Thumbs down reaction
      const thumbsDownBtn = actionsContainer.createEl('button', {
        cls: `message-action-btn reaction-btn ${msg.reaction === 'down' ? 'reaction-active' : ''}`,
        attr: { 'aria-label': 'Poor response' },
      });
      setIcon(thumbsDownBtn, 'thumbs-down');
      thumbsDownBtn.onclick = (e) => {
        e.stopPropagation();
        callbacks.onReact(msg.id, 'down');
      };

      // Regenerate button
      const regenBtn = actionsContainer.createEl('button', {
        cls: 'message-action-btn',
        attr: { 'aria-label': 'Regenerate response' },
      });
      setIcon(regenBtn, 'refresh-cw');
      regenBtn.onclick = (e) => {
        e.stopPropagation();
        callbacks.onRegenerate(msg.id);
      };

      // Resume from here button (shown for SDK messages with sdkUuid)
      if (callbacks.canResume(msg)) {
        const resumeBtn = actionsContainer.createEl('button', {
          cls: 'message-action-btn',
          attr: { 'aria-label': 'Resume from this point' },
        });
        setIcon(resumeBtn, 'corner-up-left');
        resumeBtn.onclick = (e) => {
          e.stopPropagation();
          callbacks.onResume(msg.id);
        };
      }
    }
  }

  function updateContent(messageId: string, content: string): void {
    const msgEl = messageElements.get(messageId);
    if (!msgEl) return;

    const contentDiv = msgEl.querySelector('.message-content');
    if (!contentDiv) return;

    // Clear existing content
    contentDiv.textContent = '';
    while (contentDiv.firstChild) {
      contentDiv.removeChild(contentDiv.firstChild);
    }

    if (content) {
      // Unload previous component if exists
      const oldComponent = renderComponents.get(messageId);
      if (oldComponent) {
        oldComponent.unload();
      }

      // Create new component for markdown renderer
      const component = new Component();
      component.load();
      renderComponents.set(messageId, component);

      MarkdownRenderer.render(
        deps.app,
        content,
        contentDiv as HTMLElement,
        deps.app.workspace.getActiveFile()?.path ?? '',
        component
      );
      // Add copy buttons to code blocks
      addCodeBlockCopyButtonsToElement(contentDiv as HTMLElement);
    }

    // Show message actions (hidden during streaming)
    const actionsDiv = msgEl.querySelector('.message-actions') as HTMLElement;
    if (actionsDiv) {
      actionsDiv.style.display = '';
    }

    callbacks.scrollToBottom();
  }

  function updateTools(messageId: string, toolCalls: ToolCallInfo[]): void {
    const msgEl = messageElements.get(messageId);
    if (!msgEl) return;

    const bubbleDiv = msgEl.querySelector('.message-bubble') as HTMLElement;
    if (!bubbleDiv) return;

    // Find or create tools container
    let toolsDiv = bubbleDiv.querySelector('.message-tools') as HTMLElement;
    if (!toolsDiv) {
      // Create tools container before content
      const contentDiv = bubbleDiv.querySelector('.message-content');
      toolsDiv = document.createElement('div');
      toolsDiv.className = 'message-tools';
      if (contentDiv) {
        bubbleDiv.insertBefore(toolsDiv, contentDiv);
      } else {
        bubbleDiv.appendChild(toolsDiv);
      }
    }

    // Clear existing tools
    while (toolsDiv.firstChild) {
      toolsDiv.removeChild(toolsDiv.firstChild);
    }

    // Render new tools via the card-type dispatch
    renderToolCalls(toolsDiv, toolCalls);
  }

  function getMessageElement(messageId: string): HTMLElement | null {
    return messageElements.get(messageId) ?? null;
  }

  function clear(): void {
    // Unload all render components
    for (const component of renderComponents.values()) {
      component.unload();
    }
    renderComponents.clear();

    // Clear message elements map
    messageElements.clear();

    // Clear container
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }

  function showWelcome(welcomeEl: HTMLElement): void {
    clear();
    container.appendChild(welcomeEl);
  }

  function addCodeBlockCopyButtonsToElement(element: HTMLElement): void {
    const codeBlocks = element.querySelectorAll('pre > code');
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

  function addCodeBlockCopyButtons(): void {
    addCodeBlockCopyButtonsToElement(container);
  }

  function updateActions(messageId: string, message: ChatMessage): void {
    const msgEl = messageElements.get(messageId);
    if (!msgEl) return;

    const actionsDiv = msgEl.querySelector('.message-actions') as HTMLElement;
    if (actionsDiv) {
      // Clear and re-render actions
      while (actionsDiv.firstChild) {
        actionsDiv.removeChild(actionsDiv.firstChild);
      }
      createMessageActions(actionsDiv, message);
    }
  }

  function updateBookmarkState(messageId: string, bookmarked: boolean): void {
    const msgEl = messageElements.get(messageId);
    if (!msgEl) return;

    msgEl.toggleClass('message-bookmarked', bookmarked);
  }

  function destroy(): void {
    clear();
  }

  return {
    renderMessage,
    updateContent,
    updateTools,
    getMessageElement,
    clear,
    showWelcome,
    addCodeBlockCopyButtons,
    updateActions,
    updateBookmarkState,
    renderPermissionCard,
    destroy,
  };
}
