/**
 * Message renderer module for ChatView.
 * Handles rendering messages, tool calls, code blocks, and message actions.
 */
import { MarkdownRenderer, Component, setIcon } from 'obsidian';
import type { ChatMessage, ToolCallInfo, ModuleDeps, ModuleHandle } from './types';

// Tool status to icon mapping
const TOOL_STATUS_ICONS: Record<ToolCallInfo['status'], string> = {
  completed: 'check-circle',
  running: 'loader',
  error: 'x-circle',
  pending: 'circle',
};

export interface MessageRendererCallbacks {
  onBookmarkToggle: (messageId: string) => Promise<void>;
  onReactionToggle: (messageId: string, reaction: 'up' | 'down') => Promise<void>;
  onRegenerate: (messageId: string) => void;
  onResumeFromMessage: (msg: ChatMessage) => Promise<void>;
  getBackendType: () => string;
  getShowToolCalls: () => boolean;
  getShowMessageActions: () => boolean;
}

export interface MessageRendererHandle extends ModuleHandle {
  renderMessage(msg: ChatMessage): HTMLElement | null;
  renderAllMessages(messages: ChatMessage[]): void;
  updateMessageContent(messageId: string, content: string): void;
  updateMessageTools(messageId: string, toolCalls: ToolCallInfo[]): void;
  showWelcomeState(isMobile: boolean): void;
  clearMessages(): void;
  getMessageElement(messageId: string): HTMLElement | undefined;
  scrollToBottom(force?: boolean): void;
}

export function createMessageRenderer(
  container: HTMLElement,
  deps: ModuleDeps,
  callbacks: MessageRendererCallbacks
): MessageRendererHandle {
  const messageElements = new Map<string, HTMLElement>();
  let userScrolledUp = false;

  // Create scroll-to-bottom button
  const scrollToBottomBtn = container.createEl('button', {
    cls: 'scroll-to-bottom-btn',
    attr: { 'aria-label': 'Scroll to bottom' },
  });
  setIcon(scrollToBottomBtn, 'arrow-down');
  scrollToBottomBtn.onclick = () => scrollToBottom(true);

  // Track scroll position
  container.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    userScrolledUp = distanceFromBottom > 100;
    scrollToBottomBtn.toggleClass('visible', userScrolledUp);
  });

  function scrollToBottom(force = false): void {
    if (force || !userScrolledUp) {
      container.scrollTop = container.scrollHeight;
    }
  }

  function clearMessages(): void {
    container.empty();
    messageElements.clear();
    // Re-add scroll button
    container.appendChild(scrollToBottomBtn);
  }

  function showWelcomeState(isMobile: boolean): void {
    if (isMobile) {
      const hint = container.createDiv('mobile-swipe-hint');
      hint.style.cssText = 'text-align: center; padding: 1rem; color: var(--text-muted); font-size: 0.9rem;';
      hint.setText('Swipe right for history');
    } else {
      const welcomeContainer = container.createDiv('desktop-welcome');
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

  function renderMessage(msg: ChatMessage): HTMLElement | null {
    const msgDiv = container.createDiv('chat-message');
    msgDiv.addClass(msg.role === 'user' ? 'user-message' : 'assistant-message');
    if (msg.bookmarked) {
      msgDiv.addClass('message-bookmarked');
    }
    msgDiv.dataset.messageId = msg.id;

    // Message header (role + time)
    const headerDiv = msgDiv.createDiv('message-header');
    const roleLabel = headerDiv.createSpan('message-role');
    roleLabel.setText(msg.role === 'user' ? 'You' : 'Claude');
    const timeEl = headerDiv.createSpan('message-time');
    timeEl.setText(new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

    // Message bubble
    const bubbleDiv = msgDiv.createDiv('message-bubble');

    // Tool calls FIRST (shown above content)
    if (msg.toolCalls && msg.toolCalls.length > 0 && callbacks.getShowToolCalls()) {
      const toolsDiv = bubbleDiv.createDiv('message-tools');
      for (const tool of msg.toolCalls) {
        renderToolCall(toolsDiv, tool);
      }
    }

    // Content inside bubble
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
        imgEl.onclick = () => {
          window.open(`data:${img.mimeType};base64,${img.data}`, '_blank');
        };
      }
    }

    if (msg.content) {
      MarkdownRenderer.render(
        deps.app,
        msg.content,
        contentDiv,
        '',
        new Component()
      );
      addCodeBlockCopyButtons(contentDiv);
    } else if (msg.isStreaming) {
      contentDiv.createDiv('typing-indicator');
    }

    // Message action buttons
    if (callbacks.getShowMessageActions()) {
      const actionsDiv = msgDiv.createDiv('message-actions');
      if (msg.isStreaming) {
        actionsDiv.style.display = 'none';
      }
      createMessageActions(actionsDiv, msg);
    }

    messageElements.set(msg.id, msgDiv);
    return msgDiv;
  }

  function renderAllMessages(messages: ChatMessage[]): void {
    clearMessages();

    if (messages.length === 0) {
      showWelcomeState(false);
    } else {
      for (const msg of messages) {
        renderMessage(msg);
      }
    }

    userScrolledUp = false;
    scrollToBottom(true);
  }

  function createMessageActions(container: HTMLElement, msg: ChatMessage): void {
    // Bookmark button
    const bookmarkBtn = container.createEl('button', {
      cls: `message-action-btn bookmark-btn ${msg.bookmarked ? 'bookmark-active' : ''}`,
      attr: { 'aria-label': msg.bookmarked ? 'Remove bookmark' : 'Bookmark message' }
    });
    setIcon(bookmarkBtn, msg.bookmarked ? 'bookmark-check' : 'bookmark');
    bookmarkBtn.onclick = (e) => {
      e.stopPropagation();
      callbacks.onBookmarkToggle(msg.id);
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
        callbacks.onReactionToggle(msg.id, 'up');
      };

      // Thumbs down reaction
      const thumbsDownBtn = container.createEl('button', {
        cls: `message-action-btn reaction-btn ${msg.reaction === 'down' ? 'reaction-active' : ''}`,
        attr: { 'aria-label': 'Poor response' }
      });
      setIcon(thumbsDownBtn, 'thumbs-down');
      thumbsDownBtn.onclick = (e) => {
        e.stopPropagation();
        callbacks.onReactionToggle(msg.id, 'down');
      };

      // Regenerate button
      const regenBtn = container.createEl('button', {
        cls: 'message-action-btn',
        attr: { 'aria-label': 'Regenerate response' }
      });
      setIcon(regenBtn, 'refresh-cw');
      regenBtn.onclick = (e) => {
        e.stopPropagation();
        callbacks.onRegenerate(msg.id);
      };

      // Resume from here button (SDK only)
      if (msg.sdkUuid && callbacks.getBackendType() === 'sdk') {
        const resumeBtn = container.createEl('button', {
          cls: 'message-action-btn',
          attr: { 'aria-label': 'Resume from this point' }
        });
        setIcon(resumeBtn, 'corner-up-left');
        resumeBtn.onclick = (e) => {
          e.stopPropagation();
          callbacks.onResumeFromMessage(msg);
        };
      }
    }
  }

  function renderToolCall(container: HTMLElement, tool: ToolCallInfo): void {
    const toolDiv = container.createDiv('tool-call');
    toolDiv.addClass(`tool-status-${tool.status}`);

    const headerDiv = toolDiv.createDiv('tool-call-header');
    headerDiv.setAttribute('aria-label', 'Click to expand details');

    const iconEl = headerDiv.createSpan('tool-icon');
    setIcon(iconEl, TOOL_STATUS_ICONS[tool.status]);

    const nameEl = headerDiv.createSpan('tool-name');
    nameEl.setText(tool.name);

    const summaryEl = headerDiv.createSpan('tool-summary');
    summaryEl.setText(getToolSummary(tool));

    const chevronEl = headerDiv.createSpan('tool-chevron');
    setIcon(chevronEl, 'chevron-right');

    // Expandable details section
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

    // Toggle expansion
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
        for (const val of Object.values(input)) {
          if (typeof val === 'string' && val.length > 0) {
            return val.length > 30 ? val.slice(0, 30) + '...' : val;
          }
        }
        return '';
    }
  }

  function addCodeBlockCopyButtons(containerEl: HTMLElement): void {
    const codeBlocks = containerEl.querySelectorAll('pre > code');
    codeBlocks.forEach((codeEl) => {
      const pre = codeEl.parentElement;
      if (!pre || pre.querySelector('.code-copy-btn')) return;

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

  function updateMessageContent(messageId: string, content: string): void {
    const msgEl = messageElements.get(messageId);
    if (!msgEl) return;

    const contentDiv = msgEl.querySelector('.message-content');
    if (!contentDiv) return;

    contentDiv.empty();

    if (content) {
      MarkdownRenderer.render(
        deps.app,
        content,
        contentDiv as HTMLElement,
        '',
        new Component()
      );
      addCodeBlockCopyButtons(contentDiv as HTMLElement);
    }

    // Show message actions (hidden during streaming)
    const actionsDiv = msgEl.querySelector('.message-actions') as HTMLElement;
    if (actionsDiv) {
      actionsDiv.style.display = '';
    }

    scrollToBottom();
  }

  function updateMessageTools(messageId: string, toolCalls: ToolCallInfo[]): void {
    const msgEl = messageElements.get(messageId);
    if (!msgEl) return;

    const bubbleDiv = msgEl.querySelector('.message-bubble') as HTMLElement;
    if (!bubbleDiv) return;

    let toolsDiv = bubbleDiv.querySelector('.message-tools') as HTMLElement;
    if (!toolsDiv) {
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
      renderToolCall(toolsDiv, tool);
    }
  }

  function destroy(): void {
    container.empty();
    messageElements.clear();
  }

  return {
    renderMessage,
    renderAllMessages,
    updateMessageContent,
    updateMessageTools,
    showWelcomeState,
    clearMessages,
    getMessageElement: (id) => messageElements.get(id),
    scrollToBottom,
    destroy,
  };
}
