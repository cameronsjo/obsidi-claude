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

    // Tool calls FIRST (shown above content, like Claude Code)
    if (
      message.toolCalls &&
      message.toolCalls.length > 0 &&
      deps.plugin.settings.showToolCalls
    ) {
      const toolsDiv = bubbleDiv.createDiv('message-tools');
      for (const tool of message.toolCalls) {
        renderToolCall(toolsDiv, tool);
      }
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

  function renderToolCall(container: HTMLElement, tool: ToolCallInfo): void {
    const toolDiv = container.createDiv('tool-call');
    toolDiv.addClass(`tool-status-${tool.status}`);

    // Tool header row with icon and name (clickable to expand)
    const headerDiv = toolDiv.createDiv('tool-call-header');
    headerDiv.setAttribute('aria-label', 'Click to expand details');

    const iconEl = headerDiv.createSpan('tool-icon');
    setIcon(iconEl, TOOL_STATUS_ICONS[tool.status]);

    const nameEl = headerDiv.createSpan('tool-name');
    nameEl.textContent = tool.name;

    // Brief summary on the right
    const summaryEl = headerDiv.createSpan('tool-summary');
    summaryEl.textContent = getToolSummary(tool);

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
      inputContent.createEl('pre').textContent = JSON.stringify(tool.input, null, 2);
    }

    // Result section
    if (tool.result) {
      const resultSection = detailsDiv.createDiv('tool-detail-section');
      resultSection.createEl('div', {
        text: tool.status === 'error' ? 'Error' : 'Result',
        cls: 'tool-detail-label',
      });
      const resultContent = resultSection.createDiv('tool-detail-content');
      resultContent.createEl('pre').textContent = tool.result;
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

  function getToolSummary(tool: ToolCallInfo): string {
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

    // Render new tools
    for (const tool of toolCalls) {
      renderToolCall(toolsDiv, tool);
    }
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
    destroy,
  };
}
