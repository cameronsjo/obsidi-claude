/**
 * Mobile support module for ChatView.
 * Handles mobile-specific UI elements like FAB, swipe gestures, and hints.
 */
import { setIcon } from 'obsidian';
import type { ModuleDeps, ModuleHandle } from './types';

/**
 * Swipe threshold in pixels for detecting swipe gestures.
 */
const SWIPE_THRESHOLD = 50;

/**
 * Callbacks for mobile support to communicate with parent.
 */
export interface MobileSupportCallbacks {
  onNewConversation: () => void;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  isMobile: () => boolean;
}

/**
 * Handle for controlling mobile support features.
 */
export interface MobileSupportHandle extends ModuleHandle {
  isMobile(): boolean;
  showSwipeHint(container: HTMLElement): void;
  setupTouchHandling(container: HTMLElement): void;
}

/**
 * Create mobile support for handling mobile-specific UI and gestures.
 * @param container - Parent element to attach mobile UI elements to
 * @param _deps - Module dependencies (reserved for future use)
 * @param callbacks - Callbacks for parent communication
 */
export function createMobileSupport(
  container: HTMLElement,
  _deps: ModuleDeps,
  callbacks: MobileSupportCallbacks
): MobileSupportHandle {
  let fabElement: HTMLElement | null = null;

  // Create FAB only on mobile
  if (callbacks.isMobile()) {
    fabElement = container.createDiv('mobile-fab');
    fabElement.setAttribute('aria-label', 'New conversation');
    const fabIcon = fabElement.createSpan('fab-icon');
    setIcon(fabIcon, 'plus');
    fabElement.onclick = (): void => callbacks.onNewConversation();
  }

  function isMobile(): boolean {
    return callbacks.isMobile();
  }

  function showSwipeHint(hintContainer: HTMLElement): void {
    if (!callbacks.isMobile()) {
      return;
    }

    const hint = hintContainer.createDiv('mobile-swipe-hint');
    const hintIcon = hint.createSpan('hint-icon');
    setIcon(hintIcon, 'message-circle');
    const hintTitle = hint.createSpan('hint-title');
    hintTitle.textContent = 'Swipe to navigate';
    const hintText = hint.createSpan('hint-text');
    hintText.textContent = 'Swipe left or right to switch conversations';
  }

  function setupTouchHandling(touchContainer: HTMLElement): void {
    if (!callbacks.isMobile()) {
      return;
    }

    let startX = 0;
    let startY = 0;

    const handleTouchStart = (e: TouchEvent): void => {
      if (e.touches.length === 1) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      }
    };

    const handleTouchEnd = (e: TouchEvent): void => {
      if (e.changedTouches.length === 1) {
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const deltaX = endX - startX;
        const deltaY = Math.abs(endY - startY);

        // Check if horizontal movement exceeds threshold and vertical is within bounds
        if (Math.abs(deltaX) > SWIPE_THRESHOLD && deltaY < SWIPE_THRESHOLD) {
          if (deltaX > 0) {
            callbacks.onSwipeRight();
          } else {
            callbacks.onSwipeLeft();
          }
        }
      }
    };

    touchContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
    touchContainer.addEventListener('touchend', handleTouchEnd, { passive: true });
  }

  function destroy(): void {
    if (fabElement) {
      fabElement.remove();
      fabElement = null;
    }
  }

  return {
    isMobile,
    showSwipeHint,
    setupTouchHandling,
    destroy,
  };
}
