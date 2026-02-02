/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createKeyboardHandler,
  type KeyboardHandlerHandle,
  type KeyboardHandlerCallbacks,
} from '../../src/chatView/keyboardHandler';
import type { ModuleDeps } from '../../src/chatView/types';

describe('KeyboardHandler', () => {
  let container: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: KeyboardHandlerCallbacks;
  let handle: KeyboardHandlerHandle;

  function dispatchKeydown(
    key: string,
    options: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}
  ): void {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    container.dispatchEvent(event);
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    deps = {
      app: {} as ModuleDeps['app'],
      plugin: {} as ModuleDeps['plugin'],
    };
    callbacks = {
      onNewConversation: vi.fn(),
      onToggleSearch: vi.fn(),
      onToggleHistory: vi.fn(),
      onFocusInput: vi.fn(),
      onExport: vi.fn(),
      onTogglePin: vi.fn(),
      isSearchVisible: vi.fn(() => false),
      isHistoryVisible: vi.fn(() => false),
    };
  });

  afterEach(() => {
    handle?.destroy();
    container.remove();
  });

  describe('creation', () => {
    it('should create keyboard handler', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      expect(handle).toBeDefined();
      expect(handle.register).toBeDefined();
      expect(handle.unregister).toBeDefined();
      expect(handle.destroy).toBeDefined();
    });

    it('should make container focusable after registration', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      expect(container.getAttribute('tabindex')).toBe('-1');
    });
  });

  describe('Ctrl/Cmd+F - search toggle', () => {
    it('should trigger search toggle on Ctrl+F', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('f', { ctrlKey: true });
      expect(callbacks.onToggleSearch).toHaveBeenCalledOnce();
    });

    it('should trigger search toggle on Cmd+F (macOS)', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('f', { metaKey: true });
      expect(callbacks.onToggleSearch).toHaveBeenCalledOnce();
    });
  });

  describe('Ctrl/Cmd+N - new conversation', () => {
    it('should trigger new conversation on Ctrl+N', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('n', { ctrlKey: true });
      expect(callbacks.onNewConversation).toHaveBeenCalledOnce();
    });

    it('should trigger new conversation on Cmd+N (macOS)', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('n', { metaKey: true });
      expect(callbacks.onNewConversation).toHaveBeenCalledOnce();
    });
  });

  describe('Ctrl/Cmd+H - history toggle', () => {
    it('should trigger history toggle on Ctrl+H', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('h', { ctrlKey: true });
      expect(callbacks.onToggleHistory).toHaveBeenCalledOnce();
    });

    it('should trigger history toggle on Cmd+H (macOS)', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('h', { metaKey: true });
      expect(callbacks.onToggleHistory).toHaveBeenCalledOnce();
    });
  });

  describe('Ctrl/Cmd+E - export', () => {
    it('should trigger export on Ctrl+E', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('e', { ctrlKey: true });
      expect(callbacks.onExport).toHaveBeenCalledOnce();
    });

    it('should trigger export on Cmd+E (macOS)', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('e', { metaKey: true });
      expect(callbacks.onExport).toHaveBeenCalledOnce();
    });
  });

  describe('Ctrl/Cmd+Shift+P - pin toggle', () => {
    it('should trigger pin toggle on Ctrl+Shift+P', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('p', { ctrlKey: true, shiftKey: true });
      expect(callbacks.onTogglePin).toHaveBeenCalledOnce();
    });

    it('should trigger pin toggle on Cmd+Shift+P (macOS)', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('p', { metaKey: true, shiftKey: true });
      expect(callbacks.onTogglePin).toHaveBeenCalledOnce();
    });

    it('should not trigger pin toggle without Shift', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('p', { ctrlKey: true });
      expect(callbacks.onTogglePin).not.toHaveBeenCalled();
    });
  });

  describe('Ctrl/Cmd+L - focus input', () => {
    it('should trigger focus input on Ctrl+L', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('l', { ctrlKey: true });
      expect(callbacks.onFocusInput).toHaveBeenCalledOnce();
    });

    it('should trigger focus input on Cmd+L (macOS)', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('l', { metaKey: true });
      expect(callbacks.onFocusInput).toHaveBeenCalledOnce();
    });
  });

  describe('Escape key', () => {
    it('should close search when visible', () => {
      callbacks.isSearchVisible = vi.fn(() => true);
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('Escape');
      expect(callbacks.onToggleSearch).toHaveBeenCalledOnce();
      expect(callbacks.onToggleHistory).not.toHaveBeenCalled();
      expect(callbacks.onFocusInput).not.toHaveBeenCalled();
    });

    it('should close history when visible and search is not', () => {
      callbacks.isSearchVisible = vi.fn(() => false);
      callbacks.isHistoryVisible = vi.fn(() => true);
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('Escape');
      expect(callbacks.onToggleHistory).toHaveBeenCalledOnce();
      expect(callbacks.onToggleSearch).not.toHaveBeenCalled();
      expect(callbacks.onFocusInput).not.toHaveBeenCalled();
    });

    it('should focus input when nothing is visible', () => {
      callbacks.isSearchVisible = vi.fn(() => false);
      callbacks.isHistoryVisible = vi.fn(() => false);
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('Escape');
      expect(callbacks.onFocusInput).toHaveBeenCalledOnce();
      expect(callbacks.onToggleSearch).not.toHaveBeenCalled();
      expect(callbacks.onToggleHistory).not.toHaveBeenCalled();
    });
  });

  describe('unregister', () => {
    it('should stop responding to shortcuts after unregister', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      handle.unregister();
      dispatchKeydown('n', { ctrlKey: true });
      expect(callbacks.onNewConversation).not.toHaveBeenCalled();
    });

    it('should allow re-registration after unregister', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      handle.unregister();
      handle.register();
      dispatchKeydown('n', { ctrlKey: true });
      expect(callbacks.onNewConversation).toHaveBeenCalledOnce();
    });
  });

  describe('destruction', () => {
    it('should clean up event listeners on destroy', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      handle.destroy();
      dispatchKeydown('n', { ctrlKey: true });
      expect(callbacks.onNewConversation).not.toHaveBeenCalled();
    });
  });

  describe('non-matching keys', () => {
    it('should not trigger callbacks for unregistered shortcuts', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('a', { ctrlKey: true });
      expect(callbacks.onNewConversation).not.toHaveBeenCalled();
      expect(callbacks.onToggleSearch).not.toHaveBeenCalled();
      expect(callbacks.onToggleHistory).not.toHaveBeenCalled();
      expect(callbacks.onFocusInput).not.toHaveBeenCalled();
      expect(callbacks.onExport).not.toHaveBeenCalled();
      expect(callbacks.onTogglePin).not.toHaveBeenCalled();
    });

    it('should not trigger callbacks for non-modified key presses', () => {
      handle = createKeyboardHandler(container, deps, callbacks);
      handle.register();
      dispatchKeydown('n');
      expect(callbacks.onNewConversation).not.toHaveBeenCalled();
    });
  });
});
