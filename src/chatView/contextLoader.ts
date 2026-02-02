/**
 * Context loader module for ChatView.
 * Handles loading file, folder, and vault context for chat messages.
 * Tracks sent notes to enable delta updates and avoid redundant context.
 */
import { MarkdownView } from 'obsidian';
import type { ModuleDeps, ModuleHandle } from './types';
import { createLogger } from '../logger';

const log = createLogger('ContextLoader');

/**
 * Context type enumeration.
 */
export type ContextType = 'file' | 'folder' | 'vault' | 'none';

/**
 * Context information for the active note badge display.
 */
export interface ActiveContextInfo {
  type: ContextType;
  name: string;
  path?: string;
}

/**
 * Editor selection with line range.
 */
export interface EditorSelection {
  text: string;
  startLine: number;
  endLine: number;
}

/**
 * Last sent note tracking.
 */
export interface LastSentNote {
  path: string;
  content: string;
}

/**
 * Context result from loading.
 */
export interface ContextResult {
  /** Original user message */
  originalContent: string;
  /** Message with context injected */
  messageContent: string;
  /** Display content (without context) for UI */
  displayContent?: string;
}

/**
 * Callbacks for context loader to communicate with parent.
 */
export interface ContextLoaderCallbacks {
  onContextChange: (info: ActiveContextInfo | null) => void;
}

/**
 * Handle for controlling the context loader.
 */
export interface ContextLoaderHandle extends ModuleHandle {
  /**
   * Load context and build message content.
   * @param userContent - The user's original message
   * @returns Context result with injected content
   */
  load(userContent: string): Promise<ContextResult>;

  /**
   * Get current context information.
   */
  getInfo(): ActiveContextInfo | null;

  /**
   * Estimate tokens for current context.
   */
  estimateTokens(): number;

  /**
   * Refresh context (re-check active file).
   */
  refresh(): void;

  /**
   * Clear context state.
   */
  clear(): void;

  /**
   * Get last sent note info.
   */
  getLastSentNote(): LastSentNote | null;

  /**
   * Set last sent note info (for restoring state).
   */
  setLastSentNote(path: string, content: string): void;

  /**
   * Reset note tracking (e.g., on conversation switch).
   */
  resetNoteTracking(): void;
}

/**
 * Characters per token for estimation.
 */
const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Create a context loader for managing active note context.
 * @param deps - Module dependencies
 * @param callbacks - Callbacks for parent communication
 */
export function createContextLoader(
  deps: ModuleDeps,
  callbacks: ContextLoaderCallbacks
): ContextLoaderHandle {
  const { app, plugin } = deps;

  // Track last sent note to avoid redundant context injection
  let lastSentNotePath: string | null = null;
  let lastSentNoteContent: string | null = null;

  /**
   * Get selected text from the active editor, if any.
   * Returns the selection with line numbers for context.
   */
  function getEditorSelection(): EditorSelection | null {
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;

    const editor = view.editor;
    const selection = editor.getSelection();

    // Only return if there's actual selected text (not just cursor position)
    if (!selection || selection.trim().length === 0) return null;

    const from = editor.getCursor('from');
    const to = editor.getCursor('to');

    return {
      text: selection,
      startLine: from.line + 1, // 1-indexed for display
      endLine: to.line + 1,
    };
  }

  /**
   * Compute a diff between old and new note content.
   * Returns a formatted string showing only the changed lines with context.
   */
  function computeNoteDelta(oldContent: string, newContent: string): string | null {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const contextLines = 2; // Lines of context around changes
    const changes: string[] = [];

    // Simple line-by-line comparison to find changed regions
    const maxLen = Math.max(oldLines.length, newLines.length);
    let inChange = false;
    let changeStart = -1;

    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];
      const isDifferent = oldLine !== newLine;

      if (isDifferent && !inChange) {
        // Start of a change region
        inChange = true;
        changeStart = Math.max(0, i - contextLines);
      } else if (!isDifferent && inChange) {
        // End of a change region - output it with context
        const changeEnd = Math.min(newLines.length, i + contextLines);
        changes.push(formatChangeRegion(oldLines, newLines, changeStart, i - 1, changeEnd));
        inChange = false;
      }
    }

    // Handle change at end of file
    if (inChange) {
      const changeEnd = newLines.length;
      changes.push(formatChangeRegion(oldLines, newLines, changeStart, maxLen - 1, changeEnd));
    }

    if (changes.length === 0) {
      return null;
    }

    return changes.join('\n---\n');
  }

  /**
   * Format a single change region with context lines.
   * Uses diff-style markers: - for removed, + for added, space for context.
   */
  function formatChangeRegion(
    oldLines: string[],
    newLines: string[],
    contextStart: number,
    changeEnd: number,
    contextEnd: number
  ): string {
    const result: string[] = [];
    result.push(`[Lines ${contextStart + 1}-${contextEnd}]`);

    for (let i = contextStart; i < contextEnd; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine === newLine) {
        // Context line (unchanged)
        result.push(`  ${newLine ?? ''}`);
      } else if (oldLine === undefined) {
        // Added line
        result.push(`+ ${newLine}`);
      } else if (newLine === undefined) {
        // Removed line
        result.push(`- ${oldLine}`);
      } else {
        // Changed line
        result.push(`- ${oldLine}`);
        result.push(`+ ${newLine}`);
      }
    }

    return result.join('\n');
  }

  /**
   * Get current context information based on active file.
   */
  function getInfo(): ActiveContextInfo | null {
    if (!plugin.settings.activeNoteContext) {
      return null;
    }

    const activeFile = app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== 'md') {
      return null;
    }

    return {
      type: 'file',
      name: activeFile.basename,
      path: activeFile.path,
    };
  }

  /**
   * Estimate tokens for current context.
   */
  function estimateTokens(): number {
    const info = getInfo();
    if (!info) return 0;

    // If we have cached content, use it
    if (lastSentNoteContent && lastSentNotePath === info.path) {
      return Math.ceil(lastSentNoteContent.length / CHARS_PER_TOKEN_ESTIMATE);
    }

    // Otherwise estimate based on typical note size
    // This is a rough estimate; actual loading will be more precise
    return 0;
  }

  /**
   * Load context and build message content.
   */
  async function load(userContent: string): Promise<ContextResult> {
    let messageContent = userContent;

    if (!plugin.settings.activeNoteContext) {
      return { originalContent: userContent, messageContent };
    }

    const activeFile = app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== 'md') {
      return { originalContent: userContent, messageContent };
    }

    const notePath = activeFile.path;

    // Check for selected text first - this takes priority
    const selection = getEditorSelection();
    if (selection) {
      // Include selected text with line range for context
      messageContent = `<selected_text path="${notePath}" lines="${selection.startLine}-${selection.endLine}">\n${selection.text}\n</selected_text>\n\n${userContent}`;
      log.debug('Included selected text', {
        path: notePath,
        lines: `${selection.startLine}-${selection.endLine}`,
        length: selection.text.length,
      });
      return {
        originalContent: userContent,
        messageContent,
        displayContent: userContent,
      };
    }

    // No selection - use full note or delta
    const isNewNote = lastSentNotePath !== notePath;

    try {
      const noteContent = await app.vault.read(activeFile);

      if (isNewNote) {
        // Include full note content for new/different notes
        messageContent = `<active_note path="${notePath}">\n${noteContent}\n</active_note>\n\n${userContent}`;
        lastSentNotePath = notePath;
        lastSentNoteContent = noteContent;
        log.debug('Included active note context (new note)', {
          path: notePath,
          contentLength: noteContent.length,
        });
      } else if (lastSentNoteContent && noteContent !== lastSentNoteContent) {
        // Same note but content changed - send only the delta if it's smaller
        const delta = computeNoteDelta(lastSentNoteContent, noteContent);
        if (delta && delta.length < noteContent.length) {
          // Delta is smaller - send just the changes
          messageContent = `<active_note_changes path="${notePath}">\n${delta}\n</active_note_changes>\n\n${userContent}`;
          log.debug('Included note delta', { path: notePath, deltaLength: delta.length });
        } else if (delta) {
          // Delta is larger than full content - resend full note
          messageContent = `<active_note path="${notePath}">\n${noteContent}\n</active_note>\n\n${userContent}`;
          log.debug('Resent full note (delta too large)', {
            path: notePath,
            contentLength: noteContent.length,
          });
        }
        lastSentNoteContent = noteContent;
      }
      // If same note and no changes, just send the user's message
    } catch (err) {
      log.warn('Failed to read active note for context', { path: notePath, error: err });
      return { originalContent: userContent, messageContent };
    }

    // Return with display content if message was modified
    if (messageContent !== userContent) {
      return {
        originalContent: userContent,
        messageContent,
        displayContent: userContent,
      };
    }

    return { originalContent: userContent, messageContent };
  }

  /**
   * Refresh context (notify parent of current state).
   */
  function refresh(): void {
    const info = getInfo();
    callbacks.onContextChange(info);
  }

  /**
   * Clear all context state.
   */
  function clear(): void {
    lastSentNotePath = null;
    lastSentNoteContent = null;
    callbacks.onContextChange(null);
  }

  /**
   * Get last sent note info.
   */
  function getLastSentNote(): LastSentNote | null {
    if (lastSentNotePath && lastSentNoteContent) {
      return { path: lastSentNotePath, content: lastSentNoteContent };
    }
    return null;
  }

  /**
   * Set last sent note info.
   */
  function setLastSentNote(path: string, content: string): void {
    lastSentNotePath = path;
    lastSentNoteContent = content;
  }

  /**
   * Reset note tracking.
   */
  function resetNoteTracking(): void {
    lastSentNotePath = null;
    lastSentNoteContent = null;
  }

  /**
   * Clean up resources.
   */
  function destroy(): void {
    clear();
  }

  return {
    load,
    getInfo,
    estimateTokens,
    refresh,
    clear,
    getLastSentNote,
    setLastSentNote,
    resetNoteTracking,
    destroy,
  };
}
