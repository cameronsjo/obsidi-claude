/**
 * Mobile support module for ChatView.
 * Handles mobile-specific UI and touch gestures.
 */
import { Platform, setIcon } from 'obsidian';
import type { ModuleDeps, ModuleHandle } from './types';

export interface MobileSupportCallbacks {
  onNewConversation: () => Promise<void>;
  onToggleHistory: () => Promise<void>;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
}

export interface MobileSupportHandle extends ModuleHandle {
  isMobile(): boolean;
  createFAB(container: HTMLElement): void;
  setupTouchHandling(container: HTMLElement): void;
  addSwipeHint(container: HTMLElement): void;
}

export function createMobileSupport(
  deps: ModuleDeps,
  callbacks: MobileSupportCallbacks
): MobileSupportHandle {
  let touchStartX = 0;
  let touchStartY = 0;
  let fabElement: HTMLElement | null = null;

  function isMobile(): boolean {
    return Platform.isMobile;
  }

  function createFAB(container: HTMLElement): void {
    if (!isMobile()) return;

    fabElement = container.createDiv('mobile-fab');
    fabElement.setAttribute('aria-label', 'New conversation');
    setIcon(fabElement, 'plus');

    fabElement.onclick = () => {
      callbacks.onNewConversation();
    };
  }

  function setupTouchHandling(container: HTMLElement): void {
    if (!isMobile()) return;

    container.addEventListener(
      'touchstart',
      (e) => {
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
      },
      { passive: true }
    );

    container.addEventListener(
      'touchend',
      (e) => {
        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;

        // Only trigger if horizontal swipe is dominant
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
          if (deltaX > 0) {
            // Swipe right - show history
            callbacks.onSwipeRight();
          } else {
            // Swipe left - hide history
            callbacks.onSwipeLeft();
          }
        }
      },
      { passive: true }
    );
  }

  function addSwipeHint(container: HTMLElement): void {
    if (!isMobile()) return;

    const hint = container.createDiv('mobile-swipe-hint');
    hint.style.cssText =
      'text-align: center; padding: 1rem; color: var(--text-muted); font-size: 0.9rem;';
    hint.setText('Swipe right for history');

    // Auto-hide after a few seconds
    setTimeout(() => {
      hint.style.opacity = '0';
      hint.style.transition = 'opacity 0.5s';
      setTimeout(() => hint.remove(), 500);
    }, 3000);
  }

  function destroy(): void {
    if (fabElement) {
      fabElement.remove();
    }
  }

  return {
    isMobile,
    createFAB,
    setupTouchHandling,
    addSwipeHint,
    destroy,
  };
}
