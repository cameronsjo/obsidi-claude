/**
 * Input area module for ChatView.
 * Handles text input, sending, image attachments, and input history.
 */
import { setIcon } from 'obsidian';
import type { ModuleDeps, ModuleHandle, ImageAttachment } from './types';

/**
 * Command information for autocomplete.
 */
export interface CommandInfo {
  name: string;
  description: string;
}

/**
 * Callbacks for input area to communicate with parent.
 */
export interface InputAreaCallbacks {
  onSend: (content: string) => void;
  onStop: () => void;
  onVoiceToggle: () => void;
  onImageAdd: (image: ImageAttachment) => void;
  onImageRemove: (index: number) => void;
  onInputChange: (value: string) => void;
  getCommands: () => CommandInfo[];
  isVoiceAvailable: () => boolean;
}

/**
 * Handle for controlling the input area.
 */
export interface InputAreaHandle extends ModuleHandle {
  getValue(): string;
  setValue(value: string): void;
  clear(): void;
  focus(): void;
  setProcessing(processing: boolean): void;
  setRecording(recording: boolean): void;
  addImage(image: ImageAttachment): void;
  clearImages(): void;
  getImages(): ImageAttachment[];
  addToHistory(content: string): void;
  navigateHistory(direction: 'up' | 'down'): void;
  resize(): void;
}

const MAX_TEXTAREA_HEIGHT = 180;

/**
 * Create an input area for chat message composition.
 * @param container - Parent element to attach the input area to
 * @param _deps - Module dependencies (reserved for future use)
 * @param callbacks - Callbacks for parent communication
 */
export function createInputArea(
  container: HTMLElement,
  _deps: ModuleDeps,
  callbacks: InputAreaCallbacks
): InputAreaHandle {
  // Internal state
  let processing = false;
  let recording = false;
  const images: ImageAttachment[] = [];
  const history: string[] = [];
  let historyIndex = -1;
  let savedInput = '';

  // DOM elements
  const inputArea = container.createDiv('chat-input-area');

  // Image preview container
  const imagePreview = inputArea.createDiv('image-preview');
  imagePreview.style.display = 'none';

  // Input wrapper for textarea and buttons
  const inputWrapper = inputArea.createDiv('input-wrapper');

  // Textarea
  const textarea = inputWrapper.createEl('textarea', {
    cls: 'chat-input',
    attr: {
      placeholder: 'Type a message...',
      rows: '1',
    },
  });

  // Button container
  const buttonContainer = inputWrapper.createDiv('input-buttons');

  // Voice button
  const voiceButton = buttonContainer.createEl('button', {
    cls: 'voice-button',
    attr: { 'aria-label': 'Voice input' },
  });
  setIcon(voiceButton, 'mic');
  voiceButton.style.display = callbacks.isVoiceAvailable() ? '' : 'none';
  voiceButton.onclick = (): void => callbacks.onVoiceToggle();

  // Send button
  const sendButton = buttonContainer.createEl('button', {
    cls: 'send-button',
    attr: { 'aria-label': 'Send message' },
  });
  setIcon(sendButton, 'send');
  sendButton.onclick = (): void => handleSend();

  // Stop button (hidden by default)
  const stopButton = buttonContainer.createEl('button', {
    cls: 'stop-button',
    attr: { 'aria-label': 'Stop generation' },
  });
  setIcon(stopButton, 'square');
  stopButton.style.display = 'none';
  stopButton.onclick = (): void => callbacks.onStop();

  // Event handlers
  textarea.addEventListener('input', () => {
    callbacks.onInputChange(textarea.value);
    resize();
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'ArrowUp') {
      // Only navigate history if at start of input
      if (textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        navigateHistory('up');
      }
    } else if (e.key === 'ArrowDown') {
      // Only navigate history if at end of input
      const len = textarea.value.length;
      if (textarea.selectionStart === len && textarea.selectionEnd === len) {
        navigateHistory('down');
      }
    }
  });

  // Paste handler for images
  textarea.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          handleImageFile(file);
        }
        break;
      }
    }
  });

  // Drag and drop for images
  inputArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    inputArea.classList.add('drag-over');
  });

  inputArea.addEventListener('dragleave', () => {
    inputArea.classList.remove('drag-over');
  });

  inputArea.addEventListener('drop', (e) => {
    e.preventDefault();
    inputArea.classList.remove('drag-over');

    const files = e.dataTransfer?.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        handleImageFile(file);
      }
    }
  });

  function handleImageFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (): void => {
      const result = reader.result as string;
      // Extract base64 data from data URL
      const base64Match = result.match(/^data:([^;]+);base64,(.+)$/);
      if (base64Match) {
        const image: ImageAttachment = {
          data: base64Match[2],
          mimeType: base64Match[1],
          filename: file.name,
        };
        addImage(image);
        callbacks.onImageAdd(image);
      }
    };
    reader.readAsDataURL(file);
  }

  function handleSend(): void {
    const content = textarea.value.trim();
    if (!content && images.length === 0) return;
    if (processing) return;
    callbacks.onSend(content);
  }

  function getValue(): string {
    return textarea.value;
  }

  function setValue(value: string): void {
    textarea.value = value;
    resize();
  }

  function clear(): void {
    textarea.value = '';
    historyIndex = -1;
    savedInput = '';
    resize();
  }

  function focus(): void {
    textarea.focus();
  }

  function setProcessing(isProcessing: boolean): void {
    processing = isProcessing;
    textarea.disabled = isProcessing;
    sendButton.style.display = isProcessing ? 'none' : '';
    stopButton.style.display = isProcessing ? '' : 'none';
  }

  function setRecording(isRecording: boolean): void {
    recording = isRecording;
    if (isRecording) {
      voiceButton.classList.add('recording');
    } else {
      voiceButton.classList.remove('recording');
    }
  }

  function addImage(image: ImageAttachment): void {
    images.push(image);
    renderImagePreview();
  }

  function clearImages(): void {
    images.length = 0;
    renderImagePreview();
  }

  function getImages(): ImageAttachment[] {
    return [...images];
  }

  function renderImagePreview(): void {
    // Clear existing content using DOM API
    while (imagePreview.firstChild) {
      imagePreview.removeChild(imagePreview.firstChild);
    }

    if (images.length === 0) {
      imagePreview.style.display = 'none';
      return;
    }

    imagePreview.style.display = '';

    images.forEach((image, index) => {
      const wrapper = imagePreview.createDiv('image-thumbnail');

      const img = wrapper.createEl('img', {
        attr: {
          src: `data:${image.mimeType};base64,${image.data}`,
          alt: image.filename || 'Image attachment',
        },
      });

      const removeBtn = wrapper.createEl('button', {
        cls: 'image-remove-btn',
        attr: { 'aria-label': 'Remove image' },
      });
      setIcon(removeBtn, 'x');
      removeBtn.onclick = (): void => {
        images.splice(index, 1);
        callbacks.onImageRemove(index);
        renderImagePreview();
      };
    });
  }

  function addToHistory(content: string): void {
    if (content.trim()) {
      history.push(content);
    }
  }

  function navigateHistory(direction: 'up' | 'down'): void {
    if (history.length === 0) return;

    if (direction === 'up') {
      if (historyIndex === -1) {
        // Save current input before navigating
        savedInput = textarea.value;
        historyIndex = history.length - 1;
      } else if (historyIndex > 0) {
        historyIndex--;
      } else {
        return; // Already at oldest
      }
      textarea.value = history[historyIndex];
    } else {
      if (historyIndex === -1) return; // Not in history

      if (historyIndex < history.length - 1) {
        historyIndex++;
        textarea.value = history[historyIndex];
      } else {
        // Return to saved input
        historyIndex = -1;
        textarea.value = savedInput;
      }
    }

    resize();
  }

  function resize(): void {
    // Reset height to auto to get accurate scrollHeight
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT);
    textarea.style.height = `${newHeight}px`;
  }

  function destroy(): void {
    inputArea.remove();
  }

  // Initial resize
  resize();

  return {
    getValue,
    setValue,
    clear,
    focus,
    setProcessing,
    setRecording,
    addImage,
    clearImages,
    getImages,
    addToHistory,
    navigateHistory,
    resize,
    destroy,
  };
}
