/**
 * Input area module for ChatView.
 * Handles text input, sending, image attachments, and input history.
 */
import { setIcon } from 'obsidian';
import type { ModuleDeps, ModuleHandle, ImageAttachment } from './types';
import type { CommandInfo } from './slashCommands';

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
  onKeyDown: (e: KeyboardEvent) => boolean; // Return true if handled (to prevent default)
  getCommands: () => CommandInfo[];
  isVoiceAvailable: () => boolean;
  /** Open the permission-mode dropdown anchored to the given trigger. */
  onModeClick?: (trigger: HTMLElement) => void;
  /** Open the add-context dropdown anchored to the given trigger. */
  onContextClick?: (trigger: HTMLElement) => void;
  /** Open the model picker dropdown anchored to the given trigger. */
  onModelClick?: (trigger: HTMLElement) => void;
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
  getInputElement(): HTMLTextAreaElement;
  getWrapper(): HTMLElement;
  getButtonContainer(): HTMLElement;
  /** Update the composer mode-chip label. */
  setModeLabel(label: string): void;
  /** Update the composer model-picker label. */
  setModelLabel(label: string): void;
  /** Open the native image file picker (routes through the image path). */
  pickImage(): void;
  /** Insert text at the caret. */
  insertText(text: string): void;
}

const MAX_TEXTAREA_HEIGHT = 180;
const MAX_INPUT_HISTORY_SIZE = 50;

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
  const images: ImageAttachment[] = [];
  const history: string[] = [];
  let historyIndex = -1;
  let savedInput = '';

  // Working indicator (above the shell): "Claude is working… esc to interrupt".
  const workingEl = container.createDiv('composer-working');
  workingEl.createSpan('composer-working-dot');
  workingEl.createSpan({ cls: 'composer-working-text', text: 'Claude is working… esc to interrupt' });
  workingEl.style.display = 'none';

  // Input wrapper for textarea and buttons
  const inputWrapper = container.createDiv('chat-input-wrapper');

  // Textarea
  const textarea = inputWrapper.createEl('textarea', {
    cls: 'chat-input',
    attr: {
      placeholder: 'Reply to Claude…',
    },
  });

  // Image preview container (above buttons area)
  const imagePreview = inputWrapper.createDiv('chat-image-preview');
  imagePreview.style.display = 'none';

  // Control row (handoff composer): mode chip · + add-context · spacer · model · send.
  const buttonContainer = inputWrapper.createDiv('chat-buttons composer-controls');

  // Left cluster: mode chip + add-context + (token counter injected by status bar).
  const leftArea = buttonContainer.createDiv('chat-buttons-left');

  // Permission-mode chip (dropdown opens upward).
  const modeChip = leftArea.createEl('button', {
    cls: 'composer-mode-chip',
    attr: { 'aria-label': 'Permission mode' },
  });
  const modeSpark = modeChip.createSpan('composer-mode-spark');
  setIcon(modeSpark, 'sparkles');
  const modeLabelEl = modeChip.createSpan({ cls: 'composer-mode-label', text: 'Default' });
  const modeCaret = modeChip.createSpan('composer-caret');
  setIcon(modeCaret, 'chevron-down');
  modeChip.onclick = (e): void => {
    e.stopPropagation();
    callbacks.onModeClick?.(modeChip);
  };

  // Add-context button (dropdown opens upward).
  const addBtn = leftArea.createEl('button', {
    cls: 'composer-add-btn',
    attr: { 'aria-label': 'Add to context' },
  });
  setIcon(addBtn, 'plus');
  addBtn.onclick = (e): void => {
    e.stopPropagation();
    callbacks.onContextClick?.(addBtn);
  };

  // Spacer.
  buttonContainer.createDiv('composer-spacer');

  // Voice button.
  const voiceButton = buttonContainer.createEl('button', {
    cls: 'chat-voice-btn',
    attr: { 'aria-label': 'Voice input' },
  });
  setIcon(voiceButton, 'mic');
  voiceButton.style.display = callbacks.isVoiceAvailable() ? '' : 'none';
  voiceButton.onclick = (): void => callbacks.onVoiceToggle();

  // Model label (dropdown opens upward).
  const modelBtn = buttonContainer.createEl('button', {
    cls: 'composer-model-btn',
    attr: { 'aria-label': 'Model' },
  });
  const modelLabelEl = modelBtn.createSpan({ cls: 'composer-model-label', text: 'model' });
  const modelCaret = modelBtn.createSpan('composer-caret');
  setIcon(modelCaret, 'chevron-down');
  modelBtn.onclick = (e): void => {
    e.stopPropagation();
    callbacks.onModelClick?.(modelBtn);
  };

  // Stop button (hidden by default, replaces send while processing).
  const stopButton = buttonContainer.createEl('button', {
    cls: 'chat-stop-btn composer-send-btn',
    attr: { 'aria-label': 'Stop generating' },
  });
  setIcon(stopButton, 'square');
  stopButton.style.display = 'none';
  stopButton.onclick = (): void => callbacks.onStop();

  // Send button (filled accent, up-arrow).
  const sendButton = buttonContainer.createEl('button', {
    cls: 'chat-send-btn composer-send-btn mod-cta',
    attr: { 'aria-label': 'Send message' },
  });
  setIcon(sendButton, 'arrow-up');
  sendButton.onclick = (): void => handleSend();

  // Debounce timer for input resize
  let resizeDebounceTimer: ReturnType<typeof requestAnimationFrame> | null = null;

  // Event handlers
  textarea.addEventListener('input', () => {
    callbacks.onInputChange(textarea.value);

    // Debounced resize with RAF for smooth performance
    if (resizeDebounceTimer) {
      cancelAnimationFrame(resizeDebounceTimer);
    }
    resizeDebounceTimer = requestAnimationFrame(() => {
      resize();
    });
  });

  textarea.addEventListener('keydown', (e) => {
    // Let parent handle autocomplete navigation first
    if (callbacks.onKeyDown(e)) {
      return; // Parent handled it
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'ArrowUp' && textarea.selectionStart === 0) {
      // Navigate to previous message when cursor is at start
      e.preventDefault();
      navigateHistory('up');
    } else if (e.key === 'ArrowDown' && textarea.selectionStart === textarea.value.length) {
      // Navigate to next message when cursor is at end
      e.preventDefault();
      navigateHistory('down');
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
  inputWrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    inputWrapper.addClass('drag-over');
  });

  inputWrapper.addEventListener('dragleave', () => {
    inputWrapper.removeClass('drag-over');
  });

  inputWrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    inputWrapper.removeClass('drag-over');

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
    callbacks.onSend(content);
  }

  /** Open the native file picker for an image, routing through the image path. */
  function pickImage(): void {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.onchange = (): void => {
      const file = picker.files?.[0];
      if (file) handleImageFile(file);
    };
    picker.click();
  }

  /** Insert text at the textarea caret, then resize + focus. */
  function insertText(text: string): void {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
    const caret = start + text.length;
    textarea.selectionStart = caret;
    textarea.selectionEnd = caret;
    resize();
    textarea.focus();
    callbacks.onInputChange(textarea.value);
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
    // Keep input enabled during processing to allow message queuing
    sendButton.style.display = isProcessing ? 'none' : 'inline-flex';
    stopButton.style.display = isProcessing ? 'inline-flex' : 'none';
    workingEl.style.display = isProcessing ? 'flex' : 'none';
    inputWrapper.toggleClass('is-processing', isProcessing);
  }

  function setModeLabel(label: string): void {
    modeLabelEl.setText(label);
  }

  function setModelLabel(label: string): void {
    modelLabelEl.setText(label);
  }

  function setRecording(isRecording: boolean): void {
    if (isRecording) {
      voiceButton.addClass('recording');
      setIcon(voiceButton, 'mic-off');
    } else {
      voiceButton.removeClass('recording');
      setIcon(voiceButton, 'mic');
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
    // Clear existing content
    imagePreview.empty();

    if (images.length === 0) {
      imagePreview.style.display = 'none';
      return;
    }

    imagePreview.style.display = 'flex';

    images.forEach((image, index) => {
      const wrapper = imagePreview.createDiv('chat-image-thumb');

      wrapper.createEl('img', {
        attr: {
          src: `data:${image.mimeType};base64,${image.data}`,
          alt: image.filename || 'Image',
        },
      });

      // Remove button
      const removeBtn = wrapper.createDiv('chat-image-remove');
      removeBtn.setText('×');
      removeBtn.onclick = (): void => {
        images.splice(index, 1);
        callbacks.onImageRemove(index);
        renderImagePreview();
      };
    });
  }

  function addToHistory(content: string): void {
    if (!content.trim()) return;

    // Avoid duplicates of last entry
    if (history.length === 0 || history[history.length - 1] !== content) {
      history.push(content);

      // Limit history size
      if (history.length > MAX_INPUT_HISTORY_SIZE) {
        history.shift();
      }
    }

    // Reset navigation
    historyIndex = -1;
  }

  function navigateHistory(direction: 'up' | 'down'): void {
    if (history.length === 0) return;

    // Save current input as draft when starting to navigate
    if (historyIndex === -1 && direction === 'up') {
      savedInput = textarea.value;
    }

    // Calculate new index using reverse direction
    // (up = -1 direction to go back in time, but index increases)
    const delta = direction === 'up' ? 1 : -1;
    const newIndex = historyIndex + delta;

    if (newIndex < -1) {
      // Already at newest (draft), do nothing
      return;
    } else if (newIndex >= history.length) {
      // Past oldest, do nothing
      return;
    } else if (newIndex === -1) {
      // Back to draft
      historyIndex = -1;
      textarea.value = savedInput;
    } else {
      // Navigate to history entry (newest is at end of array)
      historyIndex = newIndex;
      const arrayIndex = history.length - 1 - newIndex;
      textarea.value = history[arrayIndex];
    }

    // Move cursor to end
    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.value.length;

    resize();
  }

  function resize(): void {
    // Reset height to auto to get accurate scrollHeight
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT);
    textarea.style.height = `${newHeight}px`;
  }

  function getInputElement(): HTMLTextAreaElement {
    return textarea;
  }

  function getWrapper(): HTMLElement {
    return inputWrapper;
  }

  function getButtonContainer(): HTMLElement {
    return leftArea;
  }

  function destroy(): void {
    if (resizeDebounceTimer) {
      cancelAnimationFrame(resizeDebounceTimer);
    }
    inputWrapper.remove();
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
    getInputElement,
    getWrapper,
    getButtonContainer,
    setModeLabel,
    setModelLabel,
    pickImage,
    insertText,
    destroy,
  };
}
