/**
 * Search bar module for ChatView.
 * Provides message search and navigation functionality.
 */
import { setIcon } from 'obsidian';
import type { ModuleDeps, ModuleHandle } from './types';

/**
 * Callbacks for search bar to communicate with parent.
 */
export interface SearchBarCallbacks {
  getMessageIds: () => string[];
  getMessageContent: (id: string) => string;
  scrollToMessage: (id: string) => void;
  highlightMessage: (id: string) => void;
  clearHighlights: () => void;
}

/**
 * Handle for controlling the search bar.
 */
export interface SearchBarHandle extends ModuleHandle {
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  search(query: string): void;
  navigateNext(): void;
  navigatePrev(): void;
  clear(): void;
}

/**
 * Create a search bar for message searching.
 * @param container - Parent element to attach the search bar to
 * @param _deps - Module dependencies (reserved for future use)
 * @param callbacks - Callbacks for parent communication
 */
export function createSearchBar(
  container: HTMLElement,
  _deps: ModuleDeps,
  callbacks: SearchBarCallbacks
): SearchBarHandle {
  // Internal state
  let visible = false;
  let query = '';
  let matches: string[] = [];
  let currentIndex = -1;

  // DOM elements
  const searchBar = container.createDiv('chat-search-bar');
  searchBar.style.display = 'none';

  const inputWrapper = searchBar.createDiv('search-input-wrapper');
  const searchInput = inputWrapper.createEl('input', {
    cls: 'search-input',
    attr: { type: 'text', placeholder: 'Search messages...' },
  });

  const resultsEl = inputWrapper.createSpan('search-results');
  resultsEl.style.display = 'none';

  const navButtons = searchBar.createDiv('search-nav');

  const prevBtn = navButtons.createEl('button', {
    cls: 'search-nav-btn',
    attr: { 'aria-label': 'Previous match' },
  });
  setIcon(prevBtn, 'chevron-up');
  prevBtn.onclick = (): void => navigatePrev();

  const nextBtn = navButtons.createEl('button', {
    cls: 'search-nav-btn',
    attr: { 'aria-label': 'Next match' },
  });
  setIcon(nextBtn, 'chevron-down');
  nextBtn.onclick = (): void => navigateNext();

  const closeBtn = navButtons.createEl('button', {
    cls: 'search-close-btn',
    attr: { 'aria-label': 'Close search' },
  });
  setIcon(closeBtn, 'x');
  closeBtn.onclick = (): void => hide();

  // Event handlers
  searchInput.addEventListener('input', () => {
    search(searchInput.value);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        navigatePrev();
      } else {
        navigateNext();
      }
    } else if (e.key === 'Escape') {
      hide();
    }
  });

  function show(): void {
    visible = true;
    searchBar.style.display = 'flex';
    searchInput.focus();
    searchInput.select();
  }

  function hide(): void {
    visible = false;
    searchBar.style.display = 'none';
    clear();
  }

  function toggle(): void {
    if (visible) {
      hide();
    } else {
      show();
    }
  }

  function isVisible(): boolean {
    return visible;
  }

  function search(newQuery: string): void {
    query = newQuery.toLowerCase().trim();
    matches = [];
    currentIndex = -1;
    callbacks.clearHighlights();

    if (!query) {
      resultsEl.style.display = 'none';
      return;
    }

    // Find matching messages
    const messageIds = callbacks.getMessageIds();
    for (const id of messageIds) {
      const content = callbacks.getMessageContent(id);
      if (content.toLowerCase().includes(query)) {
        matches.push(id);
      }
    }

    // Update results display
    if (matches.length > 0) {
      currentIndex = 0;
      resultsEl.textContent = `1 of ${matches.length}`;
      resultsEl.style.display = 'inline';
      callbacks.highlightMessage(matches[0]);
      callbacks.scrollToMessage(matches[0]);
    } else {
      resultsEl.textContent = 'No matches';
      resultsEl.style.display = 'inline';
    }
  }

  function navigateNext(): void {
    if (matches.length === 0) return;
    currentIndex = (currentIndex + 1) % matches.length;
    updateNavigation();
  }

  function navigatePrev(): void {
    if (matches.length === 0) return;
    currentIndex = (currentIndex - 1 + matches.length) % matches.length;
    updateNavigation();
  }

  function updateNavigation(): void {
    resultsEl.textContent = `${currentIndex + 1} of ${matches.length}`;
    callbacks.clearHighlights();
    callbacks.highlightMessage(matches[currentIndex]);
    callbacks.scrollToMessage(matches[currentIndex]);
  }

  function clear(): void {
    query = '';
    matches = [];
    currentIndex = -1;
    searchInput.value = '';
    resultsEl.style.display = 'none';
    callbacks.clearHighlights();
  }

  function destroy(): void {
    searchBar.remove();
  }

  return {
    show,
    hide,
    toggle,
    isVisible,
    search,
    navigateNext,
    navigatePrev,
    clear,
    destroy,
  };
}
