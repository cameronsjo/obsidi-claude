/**
 * Search bar module for ChatView.
 * Handles message search and navigation.
 */
import { setIcon } from 'obsidian';
import type { ChatMessage, ModuleDeps, ModuleHandle } from './types';

export interface SearchBarCallbacks {
  getMessages: () => ChatMessage[];
  getMessageElement: (id: string) => HTMLElement | undefined;
}

export interface SearchBarHandle extends ModuleHandle {
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  performSearch(query: string): void;
  clearHighlights(): void;
}

export function createSearchBar(
  container: HTMLElement,
  deps: ModuleDeps,
  callbacks: SearchBarCallbacks
): SearchBarHandle {
  // State
  let visible = false;
  let searchQuery = '';
  let searchMatches: string[] = [];
  let currentSearchIndex = -1;

  // Build UI
  const searchContainer = container.createDiv('chat-search-bar');
  searchContainer.style.display = 'none';

  const inputWrapper = searchContainer.createDiv('search-input-wrapper');

  const searchInput = inputWrapper.createEl('input', {
    cls: 'search-input',
    attr: {
      type: 'text',
      placeholder: 'Search messages...',
    },
  });

  searchInput.addEventListener('input', () => {
    performSearch(searchInput.value);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        navigateSearch(-1);
      } else {
        navigateSearch(1);
      }
    } else if (e.key === 'Escape') {
      hide();
    }
  });

  // Navigation buttons
  const navButtons = searchContainer.createDiv('search-nav-buttons');

  const prevBtn = navButtons.createEl('button', {
    cls: 'chat-action-btn',
    attr: { 'aria-label': 'Previous match' },
  });
  setIcon(prevBtn, 'chevron-up');
  prevBtn.onclick = () => navigateSearch(-1);

  const nextBtn = navButtons.createEl('button', {
    cls: 'chat-action-btn',
    attr: { 'aria-label': 'Next match' },
  });
  setIcon(nextBtn, 'chevron-down');
  nextBtn.onclick = () => navigateSearch(1);

  // Match count
  const countEl = searchContainer.createSpan('search-match-count');

  // Close button
  const closeBtn = navButtons.createEl('button', {
    cls: 'chat-action-btn',
    attr: { 'aria-label': 'Close search' },
  });
  setIcon(closeBtn, 'x');
  closeBtn.onclick = () => hide();

  function show(): void {
    visible = true;
    searchContainer.style.display = 'flex';
    searchInput.focus();
    searchInput.select();
  }

  function hide(): void {
    visible = false;
    searchContainer.style.display = 'none';
    clearHighlights();
    searchQuery = '';
    searchMatches = [];
    currentSearchIndex = -1;
    searchInput.value = '';
  }

  function toggle(): void {
    if (visible) {
      hide();
    } else {
      show();
    }
  }

  function performSearch(query: string): void {
    searchQuery = query.toLowerCase().trim();
    clearHighlights();
    searchMatches = [];
    currentSearchIndex = -1;

    if (!searchQuery) {
      updateSearchCount();
      return;
    }

    const messages = callbacks.getMessages();

    // Find matching messages
    for (const msg of messages) {
      if (msg.content?.toLowerCase().includes(searchQuery)) {
        searchMatches.push(msg.id);
        const msgEl = callbacks.getMessageElement(msg.id);
        if (msgEl) {
          msgEl.addClass('search-match');
        }
      }
    }

    updateSearchCount();

    // Navigate to first match
    if (searchMatches.length > 0) {
      navigateSearch(1);
    }
  }

  function navigateSearch(direction: number): void {
    if (searchMatches.length === 0) return;

    // Remove current highlight
    if (currentSearchIndex >= 0) {
      const currentId = searchMatches[currentSearchIndex];
      const currentEl = callbacks.getMessageElement(currentId);
      if (currentEl) {
        currentEl.removeClass('search-current');
      }
    }

    // Move to next/previous
    currentSearchIndex += direction;
    if (currentSearchIndex >= searchMatches.length) {
      currentSearchIndex = 0;
    } else if (currentSearchIndex < 0) {
      currentSearchIndex = searchMatches.length - 1;
    }

    // Highlight and scroll to current match
    const targetId = searchMatches[currentSearchIndex];
    const targetEl = callbacks.getMessageElement(targetId);
    if (targetEl) {
      targetEl.addClass('search-current');
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    updateSearchCount();
  }

  function updateSearchCount(): void {
    if (searchMatches.length === 0) {
      countEl.textContent = searchQuery ? 'No matches' : '';
    } else {
      countEl.textContent = `${currentSearchIndex + 1}/${searchMatches.length}`;
    }
  }

  function clearHighlights(): void {
    const messages = callbacks.getMessages();
    for (const msg of messages) {
      const msgEl = callbacks.getMessageElement(msg.id);
      if (msgEl) {
        msgEl.removeClass('search-match');
        msgEl.removeClass('search-current');
      }
    }
  }

  function destroy(): void {
    searchContainer.remove();
  }

  return {
    show,
    hide,
    toggle,
    isVisible: () => visible,
    performSearch,
    clearHighlights,
    destroy,
  };
}
