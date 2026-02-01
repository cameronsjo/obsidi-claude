/**
 * History panel module for ChatView.
 * Manages conversation list, search, tags, and bulk operations.
 */
import { setIcon } from 'obsidian';
import type { ConversationMeta, ModuleDeps, ModuleHandle } from './types';

export interface HistoryPanelState {
  visible: boolean;
  filterTag: string | null;
  searchQuery: string;
  bulkSelectMode: boolean;
  selectedIds: Set<string>;
}

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

export interface HistoryPanelHandle extends ModuleHandle {
  show(): Promise<void>;
  hide(): void;
  toggle(): Promise<void>;
  refresh(): Promise<void>;
  isVisible(): boolean;
}

export function createHistoryPanel(
  container: HTMLElement,
  deps: ModuleDeps,
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

  // DOM elements
  const panel = container.createDiv('chat-history-panel');
  panel.style.display = 'none';

  let historyList: HTMLElement;
  let tagsBar: HTMLElement;
  let bulkActionsBar: HTMLElement;
  let searchInput: HTMLInputElement;

  // Build UI
  buildPanel();

  function buildPanel(): void {
    const header = panel.createDiv('history-header');
    header.createEl('h4', { text: 'Conversations' });

    const headerActions = header.createDiv('history-header-actions');

    // Bulk select toggle
    const bulkSelectBtn = headerActions.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'Select multiple' },
    });
    setIcon(bulkSelectBtn, 'list-checks');
    bulkSelectBtn.onclick = () => toggleBulkSelectMode();

    const closeBtn = headerActions.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'Close history' },
    });
    setIcon(closeBtn, 'x');
    closeBtn.onclick = () => hide();

    // Bulk actions bar (hidden by default)
    bulkActionsBar = panel.createDiv('history-bulk-actions');
    bulkActionsBar.style.display = 'none';
    buildBulkActionsBar();

    // Search bar
    const searchBar = panel.createDiv('history-search-bar');
    searchInput = searchBar.createEl('input', {
      cls: 'history-search-input',
      attr: { type: 'text', placeholder: 'Search conversations...' },
    });
    searchInput.addEventListener('input', () => {
      state.searchQuery = searchInput.value;
      refresh();
    });

    // Tag filter bar
    tagsBar = panel.createDiv('history-tags-bar');

    // Conversation list
    historyList = panel.createDiv('history-list');
  }

  function buildBulkActionsBar(): void {
    const selectAllBtn = bulkActionsBar.createEl('button', {
      cls: 'history-bulk-btn',
      text: 'Select All',
    });
    selectAllBtn.onclick = () => selectAll();

    const deselectAllBtn = bulkActionsBar.createEl('button', {
      cls: 'history-bulk-btn',
      text: 'Deselect All',
    });
    deselectAllBtn.onclick = () => deselectAll();

    const deleteBtn = bulkActionsBar.createEl('button', {
      cls: 'history-bulk-btn history-bulk-delete',
      text: 'Delete Selected',
    });
    deleteBtn.onclick = () => deleteSelected();

    bulkActionsBar.createSpan('history-bulk-count').setText('0 selected');
  }

  function toggleBulkSelectMode(): void {
    state.bulkSelectMode = !state.bulkSelectMode;
    state.selectedIds.clear();
    bulkActionsBar.style.display = state.bulkSelectMode ? 'flex' : 'none';
    updateBulkCount();
    refresh();
  }

  function selectAll(): void {
    const items = historyList.querySelectorAll('.history-item');
    items.forEach((item) => {
      const id = (item as HTMLElement).dataset.conversationId;
      if (id) {
        state.selectedIds.add(id);
        item.addClass('history-item-selected');
        const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
        if (checkbox) checkbox.checked = true;
      }
    });
    updateBulkCount();
  }

  function deselectAll(): void {
    state.selectedIds.clear();
    const items = historyList.querySelectorAll('.history-item');
    items.forEach((item) => {
      item.removeClass('history-item-selected');
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (checkbox) checkbox.checked = false;
    });
    updateBulkCount();
  }

  async function deleteSelected(): Promise<void> {
    if (state.selectedIds.size === 0) return;

    const count = state.selectedIds.size;
    const confirmDelete = confirm(`Delete ${count} conversation${count > 1 ? 's' : ''}? This cannot be undone.`);
    if (!confirmDelete) return;

    await callbacks.onDeleteBulk(Array.from(state.selectedIds));
    state.selectedIds.clear();
    callbacks.showStatus(`Deleted ${count} conversation${count > 1 ? 's' : ''}`, 'success');
    updateBulkCount();
    await refresh();
  }

  function updateBulkCount(): void {
    const countEl = bulkActionsBar.querySelector('.history-bulk-count');
    if (countEl) {
      countEl.textContent = `${state.selectedIds.size} selected`;
    }
  }

  async function refreshTagsBar(): Promise<void> {
    tagsBar.empty();

    const allTags = await callbacks.getAllTags();
    if (allTags.length === 0) return;

    // "All" button
    const allBtn = tagsBar.createSpan({
      cls: `history-filter-tag ${state.filterTag === null ? 'filter-tag-active' : ''}`,
    });
    allBtn.setText('All');
    allBtn.onclick = () => filterByTag(null);

    // Tag buttons
    for (const tag of allTags) {
      const tagBtn = tagsBar.createSpan({
        cls: `history-filter-tag ${state.filterTag === tag ? 'filter-tag-active' : ''}`,
      });
      tagBtn.setText(tag);
      tagBtn.onclick = () => filterByTag(tag);
    }
  }

  async function filterByTag(tag: string | null): Promise<void> {
    state.filterTag = tag;
    await refreshTagsBar();
    await refreshList();
  }

  function getDateGroup(timestamp: number): string {
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

  function formatRelativeDate(date: Date): string {
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

  async function refreshList(): Promise<void> {
    historyList.empty();

    let conversations = await callbacks.getConversations();

    // Filter by tag
    if (state.filterTag) {
      conversations = conversations.filter(c =>
        c.tags && c.tags.includes(state.filterTag!)
      );
    }

    // Filter by search query
    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      conversations = conversations.filter(c =>
        c.title.toLowerCase().includes(query) ||
        (c.preview && c.preview.toLowerCase().includes(query))
      );
    }

    if (conversations.length === 0) {
      let emptyMsg = 'No conversations yet';
      if (state.searchQuery) {
        emptyMsg = `No conversations matching "${state.searchQuery}"`;
      } else if (state.filterTag) {
        emptyMsg = `No conversations with tag "${state.filterTag}"`;
      }
      historyList.createDiv('history-empty').setText(emptyMsg);
      return;
    }

    // Group by pinned and date
    const pinned = conversations.filter(c => c.pinned);
    const unpinned = conversations.filter(c => !c.pinned);

    const groups = new Map<string, ConversationMeta[]>();
    for (const conv of unpinned) {
      const group = getDateGroup(conv.updatedAt);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(conv);
    }

    // Render pinned
    if (pinned.length > 0) {
      historyList.createDiv('history-group-header').setText('📌 Pinned');
      for (const conv of pinned) {
        renderItem(conv);
      }
    }

    // Render date groups
    const groupOrder = ['Today', 'Yesterday', 'This Week', 'This Month', 'Older'];
    for (const groupName of groupOrder) {
      const groupConvs = groups.get(groupName);
      if (groupConvs && groupConvs.length > 0) {
        historyList.createDiv('history-group-header').setText(groupName);
        for (const conv of groupConvs) {
          renderItem(conv);
        }
      }
    }
  }

  function renderItem(conv: ConversationMeta): void {
    const currentId = callbacks.getCurrentId();
    const item = historyList.createDiv('history-item');
    item.dataset.conversationId = conv.id;

    if (conv.id === currentId) item.addClass('history-item-active');
    if (conv.pinned) item.addClass('history-item-pinned');
    if (state.selectedIds.has(conv.id)) item.addClass('history-item-selected');

    // Checkbox for bulk select
    if (state.bulkSelectMode) {
      const checkbox = item.createEl('input', {
        cls: 'history-item-checkbox',
        attr: { type: 'checkbox' },
      });
      checkbox.checked = state.selectedIds.has(conv.id);
      checkbox.onclick = (e) => {
        e.stopPropagation();
        if (checkbox.checked) {
          state.selectedIds.add(conv.id);
          item.addClass('history-item-selected');
        } else {
          state.selectedIds.delete(conv.id);
          item.removeClass('history-item-selected');
        }
        updateBulkCount();
      };
    }

    const info = item.createDiv('history-item-info');

    // Title row
    const titleRow = info.createDiv('history-item-title-row');
    if (conv.pinned) {
      const pinIcon = titleRow.createSpan('history-pin-indicator');
      setIcon(pinIcon, 'pin');
    }
    titleRow.createSpan('history-item-title').setText(conv.title || 'Untitled');

    // Preview
    if (conv.preview) {
      info.createDiv('history-item-preview').setText(conv.preview);
    }

    // Tags
    if (conv.tags && conv.tags.length > 0) {
      const tagsRow = info.createDiv('history-item-tags');
      for (const tag of conv.tags.slice(0, 3)) {
        tagsRow.createSpan('history-tag').setText(tag);
      }
      if (conv.tags.length > 3) {
        tagsRow.createSpan('history-tag-more').setText(`+${conv.tags.length - 3}`);
      }
    }

    // Meta
    const meta = info.createDiv('history-item-meta');
    const dateStr = formatRelativeDate(new Date(conv.updatedAt));
    meta.setText(`${conv.messageCount} messages · ${dateStr}`);

    // Click handler
    item.onclick = () => {
      if (state.bulkSelectMode) {
        const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          if (checkbox.checked) {
            state.selectedIds.add(conv.id);
            item.addClass('history-item-selected');
          } else {
            state.selectedIds.delete(conv.id);
            item.removeClass('history-item-selected');
          }
          updateBulkCount();
        }
      } else {
        callbacks.onSelect(conv.id);
      }
    };

    // Actions
    const actions = item.createDiv('history-item-actions');
    if (state.bulkSelectMode) actions.style.display = 'none';

    addActionButton(actions, conv.pinned ? 'pin-off' : 'pin', conv.pinned ? 'Unpin' : 'Pin', () =>
      callbacks.onTogglePin(conv.id)
    );
    addActionButton(actions, 'pencil', 'Rename', () =>
      promptRename(conv.id, conv.title)
    );
    addActionButton(actions, 'tag', 'Tags', () =>
      callbacks.onManageTags(conv.id, conv.tags || [])
    );
    addActionButton(actions, 'play', 'Continue', () =>
      callbacks.onContinue(conv.id)
    );
    addActionButton(actions, 'copy-plus', 'Duplicate', () =>
      callbacks.onDuplicate(conv.id)
    );
    addActionButton(actions, 'trash-2', 'Delete', () =>
      callbacks.onDelete(conv.id), 'history-delete-btn'
    );
  }

  function addActionButton(
    container: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
    extraCls = ''
  ): void {
    const btn = container.createEl('button', {
      cls: `history-action-btn ${extraCls}`,
      attr: { 'aria-label': label },
    });
    setIcon(btn, icon);
    btn.onclick = (e) => {
      e.stopPropagation();
      onClick();
    };
  }

  async function promptRename(id: string, currentTitle: string): Promise<void> {
    const newTitle = prompt('Rename conversation:', currentTitle);
    if (newTitle && newTitle !== currentTitle) {
      await callbacks.onRename(id, newTitle);
      await refresh();
    }
  }

  async function refresh(): Promise<void> {
    await refreshTagsBar();
    await refreshList();
  }

  async function show(): Promise<void> {
    state.visible = true;
    panel.style.display = 'block';
    await refresh();
  }

  function hide(): void {
    state.visible = false;
    panel.style.display = 'none';
  }

  async function toggle(): Promise<void> {
    if (state.visible) {
      hide();
    } else {
      await show();
    }
  }

  function destroy(): void {
    panel.remove();
  }

  return {
    show,
    hide,
    toggle,
    refresh,
    isVisible: () => state.visible,
    destroy,
  };
}
