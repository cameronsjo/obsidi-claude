/**
 * Inline completion service for GitHub Copilot-style ghost text suggestions.
 *
 * Provides context-aware completions while typing in Obsidian notes.
 */

import type { App, Editor, MarkdownView } from 'obsidian';
import { createLogger } from './logger';
import type { AgentBackend } from './backends';
import type { InlineCompletionSettings } from './types';

const log = createLogger('InlineCompletion');

/**
 * Manages inline text completions in the editor.
 */
export class InlineCompletionService {
  private app: App;
  private settings: InlineCompletionSettings;
  private getBackend: () => AgentBackend | null;

  // State
  private currentSuggestion: string | null = null;
  private ghostElement: HTMLElement | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCompletionTime: number[] = []; // Timestamps for rate limiting
  private isRequesting = false;
  private lastCursorPos: { line: number; ch: number } | null = null;

  constructor(
    app: App,
    settings: InlineCompletionSettings,
    getBackend: () => AgentBackend | null
  ) {
    this.app = app;
    this.settings = settings;
    this.getBackend = getBackend;
  }

  /**
   * Update settings.
   */
  updateSettings(settings: InlineCompletionSettings): void {
    this.settings = settings;
    if (!settings.enabled) {
      this.clearSuggestion();
    }
  }

  /**
   * Set up editor event listeners.
   */
  setup(): void {
    if (!this.settings.enabled) return;

    // Listen to active editor changes
    this.app.workspace.on('active-leaf-change', () => {
      this.clearSuggestion();
    });

    log.info('Inline completion service initialized');
  }

  /**
   * Handle editor change event.
   */
  onEditorChange(editor: Editor, view: MarkdownView): void {
    if (!this.settings.enabled) return;

    // Clear existing suggestion on any change
    this.clearSuggestion();

    // Get cursor position and content
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);

    // Don't trigger on empty lines or very short content
    if (line.length < this.settings.minTriggerLength) return;

    // Don't trigger if cursor is not at end of line
    if (cursor.ch < line.length) return;

    // Debounce the completion request
    this.scheduleCompletion(editor, view);
  }

  /**
   * Handle Tab key to accept suggestion.
   */
  acceptSuggestion(editor: Editor): boolean {
    if (!this.currentSuggestion) return false;

    const cursor = editor.getCursor();
    editor.replaceRange(this.currentSuggestion, cursor);
    this.clearSuggestion();

    log.debug('Suggestion accepted', { length: this.currentSuggestion.length });
    return true;
  }

  /**
   * Accept just the first word of the suggestion.
   */
  acceptWord(editor: Editor): boolean {
    if (!this.currentSuggestion) return false;

    const firstWord = this.currentSuggestion.match(/^\S+/)?.[0];
    if (!firstWord) return false;

    const cursor = editor.getCursor();
    editor.replaceRange(firstWord + ' ', cursor);

    // Update remaining suggestion
    this.currentSuggestion = this.currentSuggestion.slice(firstWord.length).trimStart();
    if (this.currentSuggestion.length === 0) {
      this.clearSuggestion();
    } else {
      this.updateGhostText(editor);
    }

    return true;
  }

  /**
   * Accept first line of the suggestion.
   */
  acceptLine(editor: Editor): boolean {
    if (!this.currentSuggestion) return false;

    const lines = this.currentSuggestion.split('\n');
    const firstLine = lines[0];

    const cursor = editor.getCursor();
    editor.replaceRange(firstLine + '\n', cursor);

    // Update remaining suggestion
    if (lines.length > 1) {
      this.currentSuggestion = lines.slice(1).join('\n');
      this.updateGhostText(editor);
    } else {
      this.clearSuggestion();
    }

    return true;
  }

  /**
   * Dismiss current suggestion.
   */
  dismissSuggestion(): void {
    this.clearSuggestion();
  }

  /**
   * Manually trigger completion.
   */
  async triggerCompletion(editor: Editor, view: MarkdownView): Promise<void> {
    if (!this.settings.enabled) return;
    await this.requestCompletion(editor, view);
  }

  /**
   * Check if there's an active suggestion.
   */
  hasSuggestion(): boolean {
    return this.currentSuggestion !== null;
  }

  // ===== PRIVATE METHODS =====

  private scheduleCompletion(editor: Editor, view: MarkdownView): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.requestCompletion(editor, view);
    }, this.settings.triggerDelay);
  }

  private async requestCompletion(editor: Editor, view: MarkdownView): Promise<void> {
    if (this.isRequesting) return;

    // Rate limiting check
    const now = Date.now();
    this.lastCompletionTime = this.lastCompletionTime.filter(t => now - t < 60000);
    if (this.lastCompletionTime.length >= this.settings.maxCompletionsPerMinute) {
      log.debug('Rate limited, skipping completion');
      return;
    }

    const backend = this.getBackend();
    if (!backend) {
      log.warn('No backend available for completion');
      return;
    }

    this.isRequesting = true;
    this.lastCompletionTime.push(now);

    try {
      const cursor = editor.getCursor();
      this.lastCursorPos = cursor;

      // Build context from surrounding text
      const context = this.buildContext(editor, cursor);
      if (!context) return;

      log.debug('Requesting completion', { contextLength: context.length });

      // Request completion from backend
      // Use a lightweight prompt for fast completions
      const prompt = `Complete the following text naturally. Only provide the completion, no explanation:

${context}`;

      // For now, we'll use a simplified approach - in a full implementation,
      // we'd use a streaming completion with structured output
      // This is a placeholder that shows the architecture

      // TODO: Implement actual completion request when backend supports lightweight queries
      // For now, simulate with a simple heuristic completion
      const suggestion = this.generateSimpleCompletion(context);

      if (suggestion && cursor.line === editor.getCursor().line) {
        this.currentSuggestion = suggestion;
        this.showGhostText(editor, suggestion);
      }
    } catch (error) {
      log.error('Completion request failed', error);
    } finally {
      this.isRequesting = false;
    }
  }

  private buildContext(editor: Editor, cursor: { line: number; ch: number }): string | null {
    const lines: string[] = [];
    let charCount = 0;

    // Get lines before cursor
    for (let i = cursor.line; i >= 0 && charCount < this.settings.maxContextLength; i--) {
      const line = i === cursor.line
        ? editor.getLine(i).slice(0, cursor.ch)
        : editor.getLine(i);
      lines.unshift(line);
      charCount += line.length + 1;
    }

    const context = lines.join('\n');
    return context.length >= this.settings.minTriggerLength ? context : null;
  }

  /**
   * Simple heuristic completion as a placeholder.
   * In production, this would call the AI backend.
   */
  private generateSimpleCompletion(context: string): string | null {
    // Common completions based on patterns
    const lastLine = context.split('\n').pop() || '';

    // List continuation
    if (/^[-*]\s+\w+$/.test(lastLine.trim())) {
      return ''; // Let user continue
    }

    // Code fence completion
    if (lastLine.trim() === '```') {
      return 'javascript\n';
    }

    // Header completion
    if (/^#{1,6}\s+$/.test(lastLine)) {
      return ''; // Let user type header
    }

    // Link completion
    if (lastLine.endsWith('[[')) {
      return ''; // Let user type link
    }

    // TODO completion
    if (lastLine.toLowerCase().includes('todo')) {
      return ': ';
    }

    // For now, return null to not show fake suggestions
    // Real implementation would call AI
    return null;
  }

  private showGhostText(editor: Editor, suggestion: string): void {
    // Get the editor's DOM element
    const editorEl = (editor as unknown as { cm?: { dom?: HTMLElement } }).cm?.dom;
    if (!editorEl) return;

    // Create ghost text element
    this.ghostElement = document.createElement('span');
    this.ghostElement.className = 'inline-completion-ghost';
    this.ghostElement.textContent = suggestion;
    this.ghostElement.style.cssText = `
      color: var(--text-faint);
      opacity: 0.5;
      pointer-events: none;
      font-style: italic;
    `;

    // Position at cursor
    // This is simplified - a full implementation would use CodeMirror's decoration API
    const cursorEl = editorEl.querySelector('.cm-cursor');
    if (cursorEl) {
      cursorEl.parentElement?.appendChild(this.ghostElement);
    }
  }

  private updateGhostText(editor: Editor): void {
    if (this.ghostElement && this.currentSuggestion) {
      this.ghostElement.textContent = this.currentSuggestion;
    }
  }

  private clearSuggestion(): void {
    this.currentSuggestion = null;
    if (this.ghostElement) {
      this.ghostElement.remove();
      this.ghostElement = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Cleanup when service is destroyed.
   */
  destroy(): void {
    this.clearSuggestion();
    log.info('Inline completion service destroyed');
  }
}
