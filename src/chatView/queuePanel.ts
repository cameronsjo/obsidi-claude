/**
 * Queue panel module for ChatView.
 * Displays queued messages waiting to be sent.
 */
import { setIcon } from 'obsidian';
import type { ModuleDeps, ModuleHandle } from './types';

/**
 * A message waiting in the queue.
 */
export interface QueuedMessage {
  content: string;
  timestamp: number;
}

/**
 * Callbacks for queue panel to communicate with parent.
 */
export interface QueuePanelCallbacks {
  onRemove: (index: number) => void;
  onClear: () => void;
}

/**
 * Handle for controlling the queue panel.
 */
export interface QueuePanelHandle extends ModuleHandle {
  add(message: QueuedMessage): void;
  remove(index: number): void;
  clear(): void;
  getNext(): QueuedMessage | null;
  getCount(): number;
  isVisible(): boolean;
  updateBadge(count: number): void;
}

const MAX_DISPLAY_LENGTH = 50;

/**
 * Truncate text to max length with ellipsis.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/**
 * Create a queue panel for displaying pending messages.
 * @param container - Parent element to attach the queue panel to
 * @param _deps - Module dependencies (reserved for future use)
 * @param callbacks - Callbacks for parent communication
 */
export function createQueuePanel(
  container: HTMLElement,
  _deps: ModuleDeps,
  callbacks: QueuePanelCallbacks
): QueuePanelHandle {
  // Internal state
  const queue: QueuedMessage[] = [];

  // DOM elements
  const queueContainer = container.createDiv('chat-queue-container');
  queueContainer.style.display = 'none';

  const header = queueContainer.createDiv('chat-queue-header');
  const badgeEl = header.createSpan('chat-queue-badge');
  const labelEl = header.createSpan('chat-queue-label');
  labelEl.textContent = 'messages queued';

  const clearBtn = header.createEl('button', {
    cls: 'chat-queue-clear-btn',
    attr: { 'aria-label': 'Clear queue' },
  });
  setIcon(clearBtn, 'trash-2');
  clearBtn.onclick = (): void => clear();

  const listContainer = queueContainer.createDiv('chat-queue-list');

  function clearListContainer(): void {
    while (listContainer.firstChild) {
      listContainer.removeChild(listContainer.firstChild);
    }
  }

  function render(): void {
    // Update visibility
    const visible = queue.length > 0;
    queueContainer.style.display = visible ? 'block' : 'none';

    // Update badge
    badgeEl.textContent = String(queue.length);

    // Clear and render list items using safe DOM methods
    clearListContainer();
    queue.forEach((msg, index) => {
      const item = listContainer.createDiv('chat-queue-item');

      const content = item.createSpan('chat-queue-item-content');
      content.textContent = truncate(msg.content, MAX_DISPLAY_LENGTH);

      const removeBtn = item.createEl('button', {
        cls: 'chat-queue-item-remove',
        attr: { 'aria-label': 'Remove from queue' },
      });
      setIcon(removeBtn, 'x');
      removeBtn.onclick = (e): void => {
        e.stopPropagation();
        remove(index);
      };
    });
  }

  function add(message: QueuedMessage): void {
    queue.push(message);
    render();
  }

  function remove(index: number): void {
    if (index >= 0 && index < queue.length) {
      queue.splice(index, 1);
      callbacks.onRemove(index);
      render();
    }
  }

  function clear(): void {
    queue.length = 0;
    callbacks.onClear();
    render();
  }

  function getNext(): QueuedMessage | null {
    if (queue.length === 0) return null;
    const next = queue.shift()!;
    render();
    return next;
  }

  function getCount(): number {
    return queue.length;
  }

  function isVisible(): boolean {
    return queue.length > 0;
  }

  function updateBadge(count: number): void {
    badgeEl.textContent = String(count);
  }

  function destroy(): void {
    queueContainer.remove();
  }

  return {
    add,
    remove,
    clear,
    getNext,
    getCount,
    isVisible,
    updateBadge,
    destroy,
  };
}
