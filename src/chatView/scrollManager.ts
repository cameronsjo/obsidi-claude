/**
 * Scroll manager module for ChatView.
 * Handles scroll tracking, scroll-to-bottom button, and scroll navigation.
 */
import { setIcon } from 'obsidian';
import type { ModuleDeps, ModuleHandle } from './types';

/**
 * Scroll threshold in pixels for detecting if user has scrolled up.
 */
const SCROLL_THRESHOLD_PX = 100;

/**
 * Callbacks for scroll manager to communicate with parent.
 */
export interface ScrollManagerCallbacks {
  onUserScrollChange: (scrolledUp: boolean) => void;
  getMessageElement?: (id: string) => HTMLElement | undefined;
}

/**
 * Handle for controlling scroll manager features.
 */
export interface ScrollManagerHandle extends ModuleHandle {
  scrollToBottom(smooth?: boolean): void;
  scrollToMessage(id: string): void;
  isUserScrolledUp(): boolean;
  showScrollButton(show: boolean): void;
  resetScrollState(): void;
}

/**
 * Create scroll manager for tracking scroll position and navigation.
 * @param messagesContainer - The messages container element to track
 * @param _deps - Module dependencies (reserved for future use)
 * @param callbacks - Callbacks for parent communication
 */
export function createScrollManager(
  messagesContainer: HTMLElement,
  _deps: ModuleDeps,
  callbacks: ScrollManagerCallbacks
): ScrollManagerHandle {
  let userScrolledUp = false;
  let scrollToBottomBtn: HTMLElement | null = null;
  let scrollHandler: (() => void) | null = null;

  // Create scroll-to-bottom button
  scrollToBottomBtn = messagesContainer.createEl('button', {
    cls: 'scroll-to-bottom-btn',
    attr: { 'aria-label': 'Scroll to bottom' },
  });
  setIcon(scrollToBottomBtn, 'arrow-down');
  scrollToBottomBtn.onclick = (): void => scrollToBottom(true);

  // Setup scroll tracking
  scrollHandler = (): void => {
    const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const wasScrolledUp = userScrolledUp;
    userScrolledUp = distanceFromBottom > SCROLL_THRESHOLD_PX;

    // Show/hide scroll-to-bottom button
    if (scrollToBottomBtn) {
      scrollToBottomBtn.toggleClass('visible', userScrolledUp);
    }

    // Notify parent of scroll state change
    if (wasScrolledUp !== userScrolledUp) {
      callbacks.onUserScrollChange(userScrolledUp);
    }
  };
  messagesContainer.addEventListener('scroll', scrollHandler);

  function scrollToBottom(force = false): void {
    if (!userScrolledUp || force) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  function scrollToMessage(id: string): void {
    const el = callbacks.getMessageElement?.(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function isUserScrolledUp(): boolean {
    return userScrolledUp;
  }

  function showScrollButton(show: boolean): void {
    if (scrollToBottomBtn) {
      scrollToBottomBtn.toggleClass('visible', show);
    }
  }

  function resetScrollState(): void {
    userScrolledUp = false;
    if (scrollToBottomBtn) {
      scrollToBottomBtn.toggleClass('visible', false);
    }
  }

  function destroy(): void {
    if (scrollHandler) {
      messagesContainer.removeEventListener('scroll', scrollHandler);
      scrollHandler = null;
    }
    if (scrollToBottomBtn) {
      scrollToBottomBtn.remove();
      scrollToBottomBtn = null;
    }
  }

  return {
    scrollToBottom,
    scrollToMessage,
    isUserScrolledUp,
    showScrollButton,
    resetScrollState,
    destroy,
  };
}
