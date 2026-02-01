/**
 * History panel module for ChatView.
 * Displays and manages conversation history with search, filtering, and bulk operations.
 */
import { setIcon, Menu } from 'obsidian';
import type { ModuleDeps, ModuleHandle, ConversationMeta } from './types';

/**
 * State for the history panel.
 */
export interface HistoryPanelState {
  visible: boolean;
  filterTag: string | null;
  searchQuery: string;
  bulkSelectMode: boolean;
  selectedIds: Set<string>;
}

/**
 * Callbacks for history panel to communicate with parent.
 */
export interface HistoryPanelCallbacks {
  onSelect: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDeleteBulk: (ids: string[]) => Promise<void>;
  onDuplicate: (id: string) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onTogglePin: (id: string) => Promise<void>;
  onManageTags: (id: string, tags: string[]) => void;
  onContinue: (id: string) => Promise<void>;
  getConversations: () => Promise<ConversationMeta[]>;
  getAllTags: () => Promise<string[]>;
  getCurrentId: () => string;
  showStatus: (msg: string, type: 'info' | 'error' | 'success') => void;
}

/**
 * Handle for controlling the history panel.
 */
export interface HistoryPanelHandle extends ModuleHandle {
  show(): Promise<void>;
  hide(): void;
  toggle(): Promise<void>;
  refresh(): Promise<void>;
  isVisible(): boolean;
}

/**
 * Format a timestamp as relative date string.
 */
function formatRelativeDate(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const days = Math.floor(diff / 86400000);

  if (days === 0) {
    return 'Today';
  } else if (days === 1) {
    return 'Yesterday';
  } else {
    return `${days} days ago`;
  }
}

/**
 * Create a history panel for displaying conversation history.
 * @param container - Parent element to attach the history panel to
 * @param _deps - Module dependencies (reserved for future use)
 * @param callbacks - Callbacks for parent communication
 */
export function createHistoryPanel(
  container: HTMLElement,
  _deps: ModuleDeps,
  callbacks: HistoryPanelCallbacks
): HistoryPanelHandle {
  // Internal state
  const state: HistoryPanelState = {
    visible: false,
    filterTag: null,
    searchQuery: '',
    bulkSelectMode: false,
    selectedIds: new Set(),
  };

  let conversations: ConversationMeta[] = [];
  let allTags: string[] = [];

  // DOM elements
  const panel = container.createDiv('chat-history-panel');
  panel.addClass('hidden');

  // Header with search and bulk controls
  const header = panel.createDiv('history-header');

  const searchInput = header.createEl('input', {
    cls: 'history-search-input',
    attr: {
      type: 'text',
      placeholder: 'Search conversations...',
    },
  });

  const bulkBtn = header.createEl('button', {
    cls: 'history-bulk-btn',
    attr: { 'aria-label': 'Bulk select' },
  });
  setIcon(bulkBtn, 'check-square');

  // Tag filter bar
  const tagBar = panel.createDiv('history-tag-bar');

  // Bulk action bar (hidden by default)
  const bulkActionBar = panel.createDiv('history-bulk-actions');
  bulkActionBar.style.display = 'none';

  const selectAllBtn = bulkActionBar.createEl('button', {
    cls: 'history-select-all-btn',
    text: 'Select All',
  });

  const deselectAllBtn = bulkActionBar.createEl('button', {
    cls: 'history-deselect-all-btn',
    text: 'Deselect All',
  });

  const bulkDeleteBtn = bulkActionBar.createEl('button', {
    cls: 'history-bulk-delete-btn',
    text: 'Delete Selected',
  });

  // Conversation list
  const listContainer = panel.createDiv('history-list');

  // Event handlers
  searchInput.addEventListener('input', () => {
    state.searchQuery = searchInput.value;
    renderList();
  });

  bulkBtn.addEventListener('click', () => {
    state.bulkSelectMode = !state.bulkSelectMode;
    state.selectedIds.clear();
    panel.toggleClass('bulk-select-mode', state.bulkSelectMode);
    bulkActionBar.style.display = state.bulkSelectMode ? 'flex' : 'none';
    renderList();
  });

  selectAllBtn.addEventListener('click', () => {
    const filtered = getFilteredConversations();
    filtered.forEach((conv) => state.selectedIds.add(conv.id));
    renderList();
  });

  deselectAllBtn.addEventListener('click', () => {
    state.selectedIds.clear();
    renderList();
  });

  bulkDeleteBtn.addEventListener('click', async () => {
    if (state.selectedIds.size === 0) return;
    const ids = Array.from(state.selectedIds);
    await callbacks.onDeleteBulk(ids);
    state.selectedIds.clear();
    await refresh();
  });

  /**
   * Get conversations filtered by search and tag.
   */
  function getFilteredConversations(): ConversationMeta[] {
    let filtered = [...conversations];

    // Filter by search query
    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      filtered = filtered.filter((conv) => conv.title.toLowerCase().includes(query));
    }

    // Filter by tag
    if (state.filterTag) {
      filtered = filtered.filter((conv) => conv.tags?.includes(state.filterTag!));
    }

    // Sort: pinned first, then by updatedAt
    filtered.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt - a.updatedAt;
    });

    return filtered;
  }

  /**
   * Render the tag filter bar.
   */
  function renderTagBar(): void {
    tagBar.empty();

    allTags.forEach((tag) => {
      const tagBtn = tagBar.createEl('button', {
        cls: 'history-tag-btn',
        text: tag,
      });

      if (state.filterTag === tag) {
        tagBtn.addClass('selected');
      }

      tagBtn.addEventListener('click', () => {
        if (state.filterTag === tag) {
          state.filterTag = null;
          tagBtn.removeClass('selected');
        } else {
          // Remove selected from all
          tagBar.querySelectorAll('.history-tag-btn').forEach((btn) => {
            btn.classList.remove('selected');
          });
          state.filterTag = tag;
          tagBtn.addClass('selected');
        }
        renderList();
      });
    });
  }

  /**
   * Render the conversation list.
   */
  function renderList(): void {
    listContainer.empty();

    const filtered = getFilteredConversations();
    const currentId = callbacks.getCurrentId();

    filtered.forEach((conv) => {
      const item = listContainer.createDiv('history-item');
      item.setAttribute('data-id', conv.id);

      if (conv.id === currentId) {
        item.addClass('current');
      }

      // Checkbox for bulk select
      if (state.bulkSelectMode) {
        const checkbox = item.createEl('input', {
          cls: 'history-item-checkbox',
          attr: { type: 'checkbox' },
        }) as HTMLInputElement;
        checkbox.checked = state.selectedIds.has(conv.id);
        checkbox.addEventListener('click', (e) => {
          e.stopPropagation();
          if (checkbox.checked) {
            state.selectedIds.add(conv.id);
          } else {
            state.selectedIds.delete(conv.id);
          }
        });
      }

      // Pin icon
      if (conv.pinned) {
        const pinIcon = item.createSpan('history-item-pin');
        setIcon(pinIcon, 'pin');
      }

      // Content
      const content = item.createDiv('history-item-content');

      const title = content.createDiv('history-item-title');
      title.setText(conv.title);

      const meta = content.createDiv('history-item-meta');
      meta.setText(`${conv.messageCount} messages • ${formatRelativeDate(conv.updatedAt)}`);

      // Click handler
      item.addEventListener('click', async () => {
        if (state.bulkSelectMode) return;
        await callbacks.onSelect(conv.id);
      });

      // Context menu
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e, conv);
      });
    });
  }

  /**
   * Show context menu for a conversation.
   */
  function showContextMenu(event: MouseEvent, conv: ConversationMeta): void {
    const menu = new Menu();

    menu.addItem((menuItem) => {
      menuItem
        .setTitle(conv.pinned ? 'Unpin' : 'Pin')
        .setIcon('pin')
        .onClick(async () => {
          await callbacks.onTogglePin(conv.id);
          await refresh();
        });
    });

    menu.addItem((menuItem) => {
      menuItem
        .setTitle('Rename')
        .setIcon('pencil')
        .onClick(async () => {
          const newTitle = prompt('Enter new title:', conv.title);
          if (newTitle && newTitle !== conv.title) {
            await callbacks.onRename(conv.id, newTitle);
            await refresh();
          }
        });
    });

    menu.addItem((menuItem) => {
      menuItem
        .setTitle('Duplicate')
        .setIcon('copy')
        .onClick(async () => {
          await callbacks.onDuplicate(conv.id);
          await refresh();
        });
    });

    menu.addSeparator();

    menu.addItem((menuItem) => {
      menuItem
        .setTitle('Delete')
        .setIcon('trash-2')
        .onClick(async () => {
          await callbacks.onDelete(conv.id);
          await refresh();
        });
    });

    menu.showAtMouseEvent(event);
  }

  /**
   * Load conversations and tags.
   */
  async function loadData(): Promise<void> {
    conversations = await callbacks.getConversations();
    allTags = await callbacks.getAllTags();
  }

  /**
   * Show the history panel.
   */
  async function show(): Promise<void> {
    state.visible = true;
    panel.removeClass('hidden');
    await loadData();
    renderTagBar();
    renderList();
  }

  /**
   * Hide the history panel.
   */
  function hide(): void {
    state.visible = false;
    panel.addClass('hidden');
  }

  /**
   * Toggle panel visibility.
   */
  async function toggle(): Promise<void> {
    if (state.visible) {
      hide();
    } else {
      await show();
    }
  }

  /**
   * Refresh the conversation list.
   */
  async function refresh(): Promise<void> {
    await loadData();
    renderTagBar();
    renderList();
  }

  /**
   * Check if panel is visible.
   */
  function isVisible(): boolean {
    return state.visible;
  }

  /**
   * Clean up the history panel.
   */
  function destroy(): void {
    panel.remove();
  }

  return {
    show,
    hide,
    toggle,
    refresh,
    isVisible,
    destroy,
  };
}
