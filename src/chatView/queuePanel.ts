/**
 * Queue panel module for ChatView.
 * Manages the message queue when processing is active.
 */
import { setIcon } from 'obsidian';
import type { ModuleDeps, ModuleHandle } from './types';

export interface QueuedMessage {
  content: string;
  timestamp: number;
}

export interface QueuePanelCallbacks {
  onProcessNext: () => Promise<void>;
  showStatus: (msg: string, type: 'info' | 'error' | 'success') => void;
}

export interface QueuePanelHandle extends ModuleHandle {
  addToQueue(content: string): void;
  removeFromQueue(index: number): void;
  clearQueue(): void;
  getQueue(): QueuedMessage[];
  isEmpty(): boolean;
  processNext(): Promise<void>;
}

export function createQueuePanel(
  container: HTMLElement,
  deps: ModuleDeps,
  callbacks: QueuePanelCallbacks
): QueuePanelHandle {
  // State
  const messageQueue: QueuedMessage[] = [];

  // Build UI
  const queueContainer = container.createDiv('chat-queue-container');
  queueContainer.style.display = 'none';

  const headerDiv = queueContainer.createDiv('queue-header');

  const titleDiv = headerDiv.createDiv('queue-title');
  titleDiv.createSpan({ text: 'Message Queue' });
  const queueBadge = titleDiv.createSpan({ cls: 'queue-badge' });

  const actionsDiv = headerDiv.createDiv('queue-actions');

  const clearBtn = actionsDiv.createEl('button', {
    cls: 'chat-action-btn',
    attr: { 'aria-label': 'Clear queue' },
  });
  setIcon(clearBtn, 'trash-2');
  clearBtn.onclick = () => clearQueue();

  // Queue list container
  const listEl = queueContainer.createDiv('queue-list');

  function updateUI(): void {
    const queueCount = messageQueue.length;

    // Show/hide queue container
    queueContainer.style.display = queueCount > 0 ? 'block' : 'none';

    // Update badge
    queueBadge.setText(String(queueCount));

    // Update list
    listEl.empty();

    messageQueue.forEach((item, index) => {
      const itemEl = listEl.createDiv('queue-item');

      const contentDiv = itemEl.createDiv('queue-item-content');

      // Show position number
      contentDiv.createSpan({ text: `${index + 1}. `, cls: 'queue-item-pos' });

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
        removeFromQueue(index);
      };
    });
  }

  function addToQueue(content: string): void {
    messageQueue.push({
      content,
      timestamp: Date.now(),
    });
    updateUI();
    callbacks.showStatus(`Message queued (${messageQueue.length} in queue)`, 'info');
  }

  function removeFromQueue(index: number): void {
    if (index >= 0 && index < messageQueue.length) {
      messageQueue.splice(index, 1);
      updateUI();
    }
  }

  function clearQueue(): void {
    messageQueue.length = 0;
    updateUI();
    callbacks.showStatus('Queue cleared', 'info');
  }

  async function processNext(): Promise<void> {
    if (messageQueue.length === 0) return;

    const nextMessage = messageQueue.shift();
    updateUI();

    if (nextMessage) {
      await callbacks.onProcessNext();
    }
  }

  function destroy(): void {
    queueContainer.remove();
  }

  return {
    addToQueue,
    removeFromQueue,
    clearQueue,
    getQueue: () => [...messageQueue],
    isEmpty: () => messageQueue.length === 0,
    processNext,
    destroy,
  };
}
