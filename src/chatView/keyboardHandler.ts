/**
 * Keyboard handler module for ChatView.
 * Manages global keyboard shortcuts for the chat interface.
 */
import type { ModuleDeps, ModuleHandle } from './types';

/**
 * Callbacks for keyboard handler to communicate with parent.
 */
export interface KeyboardHandlerCallbacks {
  onNewConversation: () => void;
  onToggleSearch: () => void;
  onToggleHistory: () => void;
  onFocusInput: () => void;
  onExport: () => void;
  onTogglePin: () => void;
  isSearchVisible: () => boolean;
  isHistoryVisible: () => boolean;
}

/**
 * Handle for controlling the keyboard handler.
 */
export interface KeyboardHandlerHandle extends ModuleHandle {
  /** Register keyboard shortcuts on the container */
  register(): void;
  /** Unregister keyboard shortcuts */
  unregister(): void;
}

/**
 * Create a keyboard handler for managing global shortcuts.
 * @param container - The container element to listen for keyboard events
 * @param _deps - Module dependencies (reserved for future use)
 * @param callbacks - Callbacks for parent communication
 */
export function createKeyboardHandler(
  container: HTMLElement,
  _deps: ModuleDeps,
  callbacks: KeyboardHandlerCallbacks
): KeyboardHandlerHandle {
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  function handleKeydown(e: KeyboardEvent): void {
    const isMod = e.ctrlKey || e.metaKey;

    // Ctrl/Cmd+F for search
    if (isMod && e.key === 'f') {
      e.preventDefault();
      e.stopPropagation();
      callbacks.onToggleSearch();
      return;
    }

    // Ctrl/Cmd+N for new conversation
    if (isMod && e.key === 'n') {
      e.preventDefault();
      e.stopPropagation();
      callbacks.onNewConversation();
      return;
    }

    // Ctrl/Cmd+H for history panel
    if (isMod && e.key === 'h') {
      e.preventDefault();
      e.stopPropagation();
      callbacks.onToggleHistory();
      return;
    }

    // Ctrl/Cmd+E for export
    if (isMod && e.key === 'e') {
      e.preventDefault();
      e.stopPropagation();
      callbacks.onExport();
      return;
    }

    // Ctrl/Cmd+Shift+P for pin toggle
    if (isMod && e.shiftKey && e.key === 'p') {
      e.preventDefault();
      e.stopPropagation();
      callbacks.onTogglePin();
      return;
    }

    // Ctrl/Cmd+L to focus input (like terminal)
    if (isMod && e.key === 'l') {
      e.preventDefault();
      e.stopPropagation();
      callbacks.onFocusInput();
      return;
    }

    // Escape to close search or history
    if (e.key === 'Escape') {
      if (callbacks.isSearchVisible()) {
        callbacks.onToggleSearch();
      } else if (callbacks.isHistoryVisible()) {
        callbacks.onToggleHistory();
      } else {
        // Focus input if nothing else to close
        callbacks.onFocusInput();
      }
    }
  }

  function register(): void {
    if (keydownHandler) {
      return; // Already registered
    }
    keydownHandler = handleKeydown;
    container.addEventListener('keydown', keydownHandler);
    // Make container focusable for keyboard events
    container.setAttribute('tabindex', '-1');
  }

  function unregister(): void {
    if (keydownHandler) {
      container.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }
  }

  function destroy(): void {
    unregister();
  }

  return {
    register,
    unregister,
    destroy,
  };
}
