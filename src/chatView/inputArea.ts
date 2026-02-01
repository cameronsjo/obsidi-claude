/**
 * Input area module for ChatView.
 * Handles text input, image attachments, voice input, and send/stop buttons.
 */
import { setIcon } from 'obsidian';
import type { ImageAttachment, ModuleDeps, ModuleHandle } from './types';

const MAX_TEXTAREA_HEIGHT_PX = 180;
const MAX_INPUT_HISTORY_SIZE = 50;

export interface InputAreaCallbacks {
  onSend: (content: string, images: ImageAttachment[]) => Promise<void>;
  onStop: () => void;
  onSlashCommand: (input: string) => Promise<boolean>;
  getIsProcessing: () => boolean;
  getCommandList: () => Array<{ name: string; description: string }>;
}

export interface InputAreaHandle extends ModuleHandle {
  focus(): void;
  getValue(): string;
  setValue(value: string): void;
  clear(): void;
  addToHistory(content: string): void;
  setProcessing(processing: boolean): void;
  getPendingImages(): ImageAttachment[];
  clearPendingImages(): void;
}

export function createInputArea(
  container: HTMLElement,
  deps: ModuleDeps,
  callbacks: InputAreaCallbacks
): InputAreaHandle {
  // State
  let inputHistory: string[] = [];
  let inputHistoryIndex = -1;
  let inputDraft = '';
  let pendingImages: ImageAttachment[] = [];
  let isRecording = false;
  let speechRecognition: SpeechRecognition | null = null;
  let resizeDebounceTimer: ReturnType<typeof requestAnimationFrame> | null = null;

  // Autocomplete state
  let autocompleteEl: HTMLElement | null = null;
  let autocompleteIndex = -1;
  let autocompleteCommands: Array<{ name: string; description: string }> = [];

  // DOM elements
  const inputWrapper = container.createDiv('chat-input-wrapper');
  const inputEl = inputWrapper.createEl('textarea', {
    cls: 'chat-input',
    attr: { placeholder: 'Ask Claude anything...' },
  });

  // Image preview container
  const imagePreviewContainer = inputWrapper.createDiv('chat-image-preview');
  imagePreviewContainer.style.display = 'none';

  // Button container
  const buttonArea = inputWrapper.createDiv('chat-buttons');

  // Left side: hint and token counter placeholder
  const leftArea = buttonArea.createDiv('chat-buttons-left');
  const hintEl = leftArea.createSpan('chat-input-hint');
  hintEl.setText('Enter to send \u00b7 Queue when busy \u00b7 /help');

  // Token counter (managed externally via status bar module)
  const tokenCounter = leftArea.createSpan('chat-token-counter');

  // Stop button
  const stopButton = buttonArea.createEl('button', { cls: 'chat-stop-btn' });
  setIcon(stopButton, 'circle-stop');
  stopButton.createSpan({ text: 'Stop' });
  stopButton.style.display = 'none';
  stopButton.onclick = () => callbacks.onStop();

  // Voice button
  const voiceButton = buttonArea.createEl('button', {
    cls: 'chat-voice-btn',
    attr: { 'aria-label': 'Voice input' },
  });
  setIcon(voiceButton, 'mic');
  voiceButton.onclick = () => toggleVoiceInput();

  // Hide if Speech API not available
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    voiceButton.style.display = 'none';
  }

  // Send button
  const sendButton = buttonArea.createEl('button', { cls: 'chat-send-btn mod-cta' });
  setIcon(sendButton, 'send');
  sendButton.createSpan({ text: 'Send' });
  sendButton.onclick = () => handleSend();

  // Event handlers
  inputEl.addEventListener('keydown', handleKeydown);
  inputEl.addEventListener('input', handleInput);
  inputEl.addEventListener('paste', handlePaste);

  // Drag and drop
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
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        handleImageFile(file);
      }
    }
  });

  function handleKeydown(e: KeyboardEvent): void {
    // Handle autocomplete navigation
    if (autocompleteEl && autocompleteCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        autocompleteIndex = Math.min(autocompleteIndex + 1, autocompleteCommands.length - 1);
        updateAutocompleteSelection();
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        autocompleteIndex = Math.max(autocompleteIndex - 1, 0);
        updateAutocompleteSelection();
        return;
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectAutocompleteCommand();
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideAutocomplete();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'ArrowUp' && inputEl.selectionStart === 0) {
      e.preventDefault();
      navigateInputHistory(-1);
    } else if (e.key === 'ArrowDown' && inputEl.selectionStart === inputEl.value.length) {
      e.preventDefault();
      navigateInputHistory(1);
    } else if (e.key === 'Escape') {
      hideAutocomplete();
    }
  }

  function handleInput(): void {
    if (resizeDebounceTimer) {
      cancelAnimationFrame(resizeDebounceTimer);
    }
    resizeDebounceTimer = requestAnimationFrame(() => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, MAX_TEXTAREA_HEIGHT_PX) + 'px';
    });

    updateAutocomplete();
  }

  function handlePaste(e: ClipboardEvent): void {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          handleImageFile(file);
        }
        break;
      }
    }
  }

  async function handleSend(): Promise<void> {
    const content = inputEl.value.trim();
    if (!content && pendingImages.length === 0) return;

    // Check for slash commands
    if (content.startsWith('/')) {
      const handled = await callbacks.onSlashCommand(content);
      if (handled) {
        inputEl.value = '';
        resizeInput();
        return;
      }
    }

    // Add to history
    if (content) {
      addToHistory(content);
    }

    // Send message
    const images = [...pendingImages];
    clearPendingImages();
    inputEl.value = '';
    resizeInput();

    await callbacks.onSend(content, images);
  }

  function resizeInput(): void {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, MAX_TEXTAREA_HEIGHT_PX) + 'px';
  }

  function navigateInputHistory(direction: number): void {
    if (inputHistory.length === 0) return;

    if (inputHistoryIndex === -1) {
      inputDraft = inputEl.value;
    }

    inputHistoryIndex += direction;

    if (inputHistoryIndex < 0) {
      inputHistoryIndex = -1;
      inputEl.value = inputDraft;
    } else if (inputHistoryIndex >= inputHistory.length) {
      inputHistoryIndex = inputHistory.length - 1;
    } else {
      inputEl.value = inputHistory[inputHistoryIndex];
    }

    // Move cursor to end
    inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length;
    resizeInput();
  }

  function addToHistory(content: string): void {
    // Avoid duplicates at the front
    if (inputHistory[0] === content) return;

    inputHistory.unshift(content);
    if (inputHistory.length > MAX_INPUT_HISTORY_SIZE) {
      inputHistory.pop();
    }
    inputHistoryIndex = -1;
  }

  function handleImageFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      pendingImages.push({
        data: base64,
        mimeType: file.type,
        filename: file.name,
      });
      updateImagePreview();
    };
    reader.readAsDataURL(file);
  }

  function updateImagePreview(): void {
    imagePreviewContainer.empty();

    if (pendingImages.length === 0) {
      imagePreviewContainer.style.display = 'none';
      return;
    }

    imagePreviewContainer.style.display = 'flex';

    for (let i = 0; i < pendingImages.length; i++) {
      const img = pendingImages[i];
      const preview = imagePreviewContainer.createDiv('image-preview-item');

      const imgEl = preview.createEl('img', {
        attr: { src: `data:${img.mimeType};base64,${img.data}` },
      });

      const removeBtn = preview.createEl('button', {
        cls: 'image-preview-remove',
        attr: { 'aria-label': 'Remove image' },
      });
      setIcon(removeBtn, 'x');
      removeBtn.onclick = () => {
        pendingImages.splice(i, 1);
        updateImagePreview();
      };
    }
  }

  function toggleVoiceInput(): void {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  function startRecording(): void {
    const SpeechRecognitionAPI = (window as unknown as { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) return;

    speechRecognition = new SpeechRecognitionAPI();
    speechRecognition.continuous = false;
    speechRecognition.interimResults = true;
    speechRecognition.lang = 'en-US';

    speechRecognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join('');
      inputEl.value = transcript;
      resizeInput();
    };

    speechRecognition.onend = () => {
      isRecording = false;
      voiceButton.removeClass('recording');
      setIcon(voiceButton, 'mic');
    };

    speechRecognition.onerror = () => {
      isRecording = false;
      voiceButton.removeClass('recording');
      setIcon(voiceButton, 'mic');
    };

    speechRecognition.start();
    isRecording = true;
    voiceButton.addClass('recording');
    setIcon(voiceButton, 'mic-off');
  }

  function stopRecording(): void {
    if (speechRecognition) {
      speechRecognition.stop();
      speechRecognition = null;
    }
    isRecording = false;
    voiceButton.removeClass('recording');
    setIcon(voiceButton, 'mic');
  }

  // Autocomplete functions
  function updateAutocomplete(): void {
    const value = inputEl.value;

    // Only show autocomplete if input starts with / and has no space yet
    if (!value.startsWith('/') || value.includes(' ')) {
      hideAutocomplete();
      return;
    }

    const query = value.slice(1).toLowerCase();
    const commands = callbacks.getCommandList();
    autocompleteCommands = commands.filter(
      (cmd) => cmd.name.toLowerCase().startsWith(query)
    );

    if (autocompleteCommands.length === 0) {
      hideAutocomplete();
      return;
    }

    showAutocomplete();
  }

  function showAutocomplete(): void {
    if (!autocompleteEl) {
      autocompleteEl = inputWrapper.createDiv('command-autocomplete');
    }

    autocompleteEl.empty();
    autocompleteIndex = 0;

    for (let i = 0; i < autocompleteCommands.length; i++) {
      const cmd = autocompleteCommands[i];
      const item = autocompleteEl.createDiv('autocomplete-item');
      if (i === 0) item.addClass('selected');

      item.createSpan('autocomplete-name').setText('/' + cmd.name);
      item.createSpan('autocomplete-desc').setText(cmd.description);

      item.onclick = () => {
        autocompleteIndex = i;
        selectAutocompleteCommand();
      };
    }

    autocompleteEl.style.display = 'block';
  }

  function hideAutocomplete(): void {
    if (autocompleteEl) {
      autocompleteEl.style.display = 'none';
    }
    autocompleteCommands = [];
    autocompleteIndex = -1;
  }

  function updateAutocompleteSelection(): void {
    if (!autocompleteEl) return;

    const items = autocompleteEl.querySelectorAll('.autocomplete-item');
    items.forEach((item, i) => {
      item.toggleClass('selected', i === autocompleteIndex);
    });
  }

  function selectAutocompleteCommand(): void {
    if (autocompleteIndex >= 0 && autocompleteIndex < autocompleteCommands.length) {
      const cmd = autocompleteCommands[autocompleteIndex];
      inputEl.value = '/' + cmd.name + ' ';
      resizeInput();
    }
    hideAutocomplete();
    inputEl.focus();
  }

  function setProcessing(processing: boolean): void {
    sendButton.style.display = processing ? 'none' : 'inline-flex';
    stopButton.style.display = processing ? 'inline-flex' : 'none';
    inputWrapper.toggleClass('is-processing', processing);
  }

  function clearPendingImages(): void {
    pendingImages = [];
    updateImagePreview();
  }

  function destroy(): void {
    if (speechRecognition) {
      speechRecognition.stop();
    }
    if (resizeDebounceTimer) {
      cancelAnimationFrame(resizeDebounceTimer);
    }
    container.empty();
  }

  return {
    focus: () => inputEl.focus(),
    getValue: () => inputEl.value,
    setValue: (value) => {
      inputEl.value = value;
      resizeInput();
    },
    clear: () => {
      inputEl.value = '';
      resizeInput();
    },
    addToHistory,
    setProcessing,
    getPendingImages: () => [...pendingImages],
    clearPendingImages,
    destroy,
  };
}
