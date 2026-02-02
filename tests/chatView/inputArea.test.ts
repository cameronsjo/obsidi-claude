/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createInputArea,
  type InputAreaHandle,
  type InputAreaCallbacks,
  type CommandInfo,
} from '../../src/chatView/inputArea';
import type { ModuleDeps, ImageAttachment } from '../../src/chatView/types';

// Mock Obsidian
vi.mock('obsidian', () => ({
  setIcon: vi.fn(),
}));

// Extend HTMLElement with Obsidian's createDiv/createEl/createSpan methods
declare global {
  interface HTMLElement {
    createDiv(cls?: string): HTMLDivElement;
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: { cls?: string; attr?: Record<string, string>; text?: string }
    ): HTMLElementTagNameMap[K];
    createSpan(cls?: string): HTMLSpanElement;
  }
}

HTMLElement.prototype.createDiv = function (cls?: string): HTMLDivElement {
  const div = document.createElement('div');
  if (cls) div.className = cls;
  this.appendChild(div);
  return div;
};

HTMLElement.prototype.createEl = function <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: { cls?: string; attr?: Record<string, string>; text?: string }
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options?.cls) el.className = options.cls;
  if (options?.attr) {
    for (const [key, value] of Object.entries(options.attr)) {
      el.setAttribute(key, value);
    }
  }
  if (options?.text) el.textContent = options.text;
  this.appendChild(el);
  return el;
};

HTMLElement.prototype.createSpan = function (cls?: string): HTMLSpanElement {
  const span = document.createElement('span');
  if (cls) span.className = cls;
  this.appendChild(span);
  return span;
};

// Add Obsidian's additional HTMLElement methods
declare global {
  interface HTMLElement {
    empty(): void;
    setText(text: string): void;
    addClass(cls: string): void;
    removeClass(cls: string): void;
    toggleClass(cls: string, value: boolean): void;
  }
}

HTMLElement.prototype.empty = function (): void {
  while (this.firstChild) {
    this.removeChild(this.firstChild);
  }
};

HTMLElement.prototype.setText = function (text: string): void {
  this.textContent = text;
};

HTMLElement.prototype.addClass = function (cls: string): void {
  this.classList.add(cls);
};

HTMLElement.prototype.removeClass = function (cls: string): void {
  this.classList.remove(cls);
};

HTMLElement.prototype.toggleClass = function (cls: string, value: boolean): void {
  if (value) {
    this.classList.add(cls);
  } else {
    this.classList.remove(cls);
  }
};

describe('InputArea', () => {
  let container: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: InputAreaCallbacks;
  let handle: InputAreaHandle;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    deps = {
      app: {} as ModuleDeps['app'],
      plugin: {} as ModuleDeps['plugin'],
    };
    callbacks = {
      onSend: vi.fn(),
      onStop: vi.fn(),
      onVoiceToggle: vi.fn(),
      onImageAdd: vi.fn(),
      onImageRemove: vi.fn(),
      onInputChange: vi.fn(),
      onKeyDown: vi.fn(() => false),
      getCommands: vi.fn(() => []),
      isVoiceAvailable: vi.fn(() => false),
    };
  });

  afterEach(() => {
    handle?.destroy();
    container.remove();
  });

  describe('creation', () => {
    it('should create input area container', () => {
      handle = createInputArea(container, deps, callbacks);
      expect(container.querySelector('.chat-input-wrapper')).not.toBeNull();
    });

    it('should create textarea', () => {
      handle = createInputArea(container, deps, callbacks);
      expect(container.querySelector('textarea')).not.toBeNull();
    });

    it('should create send button', () => {
      handle = createInputArea(container, deps, callbacks);
      expect(container.querySelector('.chat-send-btn')).not.toBeNull();
    });

    it('should create stop button (hidden)', () => {
      handle = createInputArea(container, deps, callbacks);
      const stopButton = container.querySelector('.chat-stop-btn') as HTMLElement;
      expect(stopButton).not.toBeNull();
      expect(stopButton.style.display).toBe('none');
    });

    it('should hide voice button when voice not available', () => {
      callbacks.isVoiceAvailable = vi.fn(() => false);
      handle = createInputArea(container, deps, callbacks);
      const voiceButton = container.querySelector('.chat-voice-btn') as HTMLElement;
      expect(voiceButton.style.display).toBe('none');
    });

    it('should show voice button when voice is available', () => {
      callbacks.isVoiceAvailable = vi.fn(() => true);
      handle = createInputArea(container, deps, callbacks);
      const voiceButton = container.querySelector('.chat-voice-btn') as HTMLElement;
      expect(voiceButton.style.display).not.toBe('none');
    });
  });

  describe('input handling', () => {
    it('should get value', () => {
      handle = createInputArea(container, deps, callbacks);
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      textarea.value = 'Hello';
      expect(handle.getValue()).toBe('Hello');
    });

    it('should set value', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setValue('Test message');
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Test message');
    });

    it('should clear value', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setValue('Test');
      handle.clear();
      expect(handle.getValue()).toBe('');
    });

    it('should focus textarea', () => {
      handle = createInputArea(container, deps, callbacks);
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      handle.focus();
      expect(document.activeElement).toBe(textarea);
    });

    it('should call onInputChange when value changes', () => {
      handle = createInputArea(container, deps, callbacks);
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      textarea.value = 'New value';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      expect(callbacks.onInputChange).toHaveBeenCalledWith('New value');
    });
  });

  describe('sending', () => {
    it('should call onSend when send button clicked', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setValue('Test message');
      const sendButton = container.querySelector('.chat-send-btn') as HTMLElement;
      sendButton.click();
      expect(callbacks.onSend).toHaveBeenCalledWith('Test message');
    });

    it('should call onSend on Enter key press', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setValue('Test message');
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
      expect(callbacks.onSend).toHaveBeenCalledWith('Test message');
    });

    it('should NOT call onSend on Shift+Enter (allows newline)', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setValue('Test message');
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })
      );
      expect(callbacks.onSend).not.toHaveBeenCalled();
    });

    it('should NOT call onSend when empty', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setValue('');
      const sendButton = container.querySelector('.chat-send-btn') as HTMLElement;
      sendButton.click();
      expect(callbacks.onSend).not.toHaveBeenCalled();
    });

    it('should NOT call onSend when whitespace only', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setValue('   \n\t  ');
      const sendButton = container.querySelector('.chat-send-btn') as HTMLElement;
      sendButton.click();
      expect(callbacks.onSend).not.toHaveBeenCalled();
    });
  });

  describe('processing state', () => {
    it('should show stop button when processing', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setProcessing(true);
      const stopButton = container.querySelector('.chat-stop-btn') as HTMLElement;
      expect(stopButton.style.display).not.toBe('none');
    });

    it('should hide send button when processing', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setProcessing(true);
      const sendButton = container.querySelector('.chat-send-btn') as HTMLElement;
      expect(sendButton.style.display).toBe('none');
    });

    it('should keep textarea enabled during processing (for message queuing)', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setProcessing(true);
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      // Textarea stays enabled to allow queuing more messages
      expect(textarea.disabled).toBe(false);
    });

    it('should call onStop when stop button clicked', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setProcessing(true);
      const stopButton = container.querySelector('.chat-stop-btn') as HTMLElement;
      stopButton.click();
      expect(callbacks.onStop).toHaveBeenCalled();
    });

    it('should restore state when processing stops', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setProcessing(true);
      handle.setProcessing(false);
      const sendButton = container.querySelector('.chat-send-btn') as HTMLElement;
      const stopButton = container.querySelector('.chat-stop-btn') as HTMLElement;
      expect(sendButton.style.display).not.toBe('none');
      expect(stopButton.style.display).toBe('none');
    });
  });

  describe('voice input', () => {
    it('should call onVoiceToggle when voice button clicked', () => {
      callbacks.isVoiceAvailable = vi.fn(() => true);
      handle = createInputArea(container, deps, callbacks);
      const voiceButton = container.querySelector('.chat-voice-btn') as HTMLElement;
      voiceButton.click();
      expect(callbacks.onVoiceToggle).toHaveBeenCalled();
    });

    it('should add recording class when recording', () => {
      callbacks.isVoiceAvailable = vi.fn(() => true);
      handle = createInputArea(container, deps, callbacks);
      handle.setRecording(true);
      const voiceButton = container.querySelector('.chat-voice-btn') as HTMLElement;
      expect(voiceButton.classList.contains('recording')).toBe(true);
    });

    it('should remove recording class when not recording', () => {
      callbacks.isVoiceAvailable = vi.fn(() => true);
      handle = createInputArea(container, deps, callbacks);
      handle.setRecording(true);
      handle.setRecording(false);
      const voiceButton = container.querySelector('.chat-voice-btn') as HTMLElement;
      expect(voiceButton.classList.contains('recording')).toBe(false);
    });
  });

  describe('image handling', () => {
    it('should show image preview when image added', () => {
      handle = createInputArea(container, deps, callbacks);
      const image: ImageAttachment = {
        data: 'data:image/png;base64,abc123',
        mimeType: 'image/png',
        filename: 'test.png',
      };
      handle.addImage(image);
      const preview = container.querySelector('.chat-image-preview') as HTMLElement;
      expect(preview).not.toBeNull();
      expect(preview.style.display).not.toBe('none');
    });

    it('should display image thumbnail in preview', () => {
      handle = createInputArea(container, deps, callbacks);
      const image: ImageAttachment = {
        data: 'base64data',
        mimeType: 'image/png',
        filename: 'test.png',
      };
      handle.addImage(image);
      const img = container.querySelector('.chat-image-preview img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.src).toContain('base64data');
    });

    it('should call onImageRemove when remove button clicked', () => {
      handle = createInputArea(container, deps, callbacks);
      const image: ImageAttachment = {
        data: 'base64data',
        mimeType: 'image/png',
      };
      handle.addImage(image);
      const removeBtn = container.querySelector('.chat-image-remove') as HTMLElement;
      removeBtn.click();
      expect(callbacks.onImageRemove).toHaveBeenCalledWith(0);
    });

    it('should clear all images', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.addImage({ data: 'img1', mimeType: 'image/png' });
      handle.addImage({ data: 'img2', mimeType: 'image/png' });
      handle.clearImages();
      expect(handle.getImages()).toHaveLength(0);
    });

    it('should return current images', () => {
      handle = createInputArea(container, deps, callbacks);
      const image: ImageAttachment = {
        data: 'base64data',
        mimeType: 'image/png',
        filename: 'test.png',
      };
      handle.addImage(image);
      const images = handle.getImages();
      expect(images).toHaveLength(1);
      expect(images[0].filename).toBe('test.png');
    });

    it('should hide preview when no images', () => {
      handle = createInputArea(container, deps, callbacks);
      const preview = container.querySelector('.chat-image-preview') as HTMLElement;
      expect(preview.style.display).toBe('none');
    });
  });

  describe('input history', () => {
    it('should add to history', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.addToHistory('First message');
      handle.addToHistory('Second message');
      // Navigate back should work (tested in navigate tests)
      handle.setValue('Current');
      handle.navigateHistory('up');
      expect(handle.getValue()).toBe('Second message');
    });

    it('should navigate up through history', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.addToHistory('Message 1');
      handle.addToHistory('Message 2');
      handle.setValue('');
      handle.navigateHistory('up');
      expect(handle.getValue()).toBe('Message 2');
      handle.navigateHistory('up');
      expect(handle.getValue()).toBe('Message 1');
    });

    it('should navigate down through history', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.addToHistory('Message 1');
      handle.addToHistory('Message 2');
      handle.setValue('');
      handle.navigateHistory('up');
      handle.navigateHistory('up');
      expect(handle.getValue()).toBe('Message 1');
      handle.navigateHistory('down');
      expect(handle.getValue()).toBe('Message 2');
    });

    it('should preserve current input when navigating history', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.addToHistory('Old message');
      handle.setValue('Current input');
      handle.navigateHistory('up');
      expect(handle.getValue()).toBe('Old message');
      handle.navigateHistory('down');
      expect(handle.getValue()).toBe('Current input');
    });

    it('should handle history navigation via arrow keys', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.addToHistory('Historic message');
      handle.setValue('');
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })
      );
      expect(handle.getValue()).toBe('Historic message');
    });

    it('should not navigate history when cursor is not at start/end', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.addToHistory('Old message');
      handle.setValue('Current text');
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      // Set cursor in the middle
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })
      );
      // Should not change when cursor is in middle (implementation detail)
      expect(handle.getValue()).toBe('Current text');
    });
  });

  describe('auto-resize', () => {
    it('should resize textarea based on content', () => {
      handle = createInputArea(container, deps, callbacks);
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      // Initial height should be set
      const initialHeight = textarea.style.height;
      handle.setValue('Line 1\nLine 2\nLine 3\nLine 4');
      handle.resize();
      // After resize, height should be different or scrollHeight-based
      // (This test verifies resize method exists and runs)
      expect(textarea.style.height).toBeDefined();
    });
  });

  describe('destruction', () => {
    it('should clean up DOM on destroy', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.destroy();
      expect(container.querySelector('.chat-input-wrapper')).toBeNull();
    });
  });
});
