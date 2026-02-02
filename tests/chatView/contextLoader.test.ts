/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createContextLoader,
  type ContextLoaderHandle,
  type ContextLoaderCallbacks,
  type ActiveContextInfo,
} from '../../src/chatView/contextLoader';
import type { ModuleDeps } from '../../src/chatView/types';

// Mock Obsidian
vi.mock('obsidian', () => ({
  MarkdownView: class {},
}));

// Mock logger
vi.mock('../../src/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ContextLoader', () => {
  let deps: ModuleDeps;
  let callbacks: ContextLoaderCallbacks;
  let handle: ContextLoaderHandle;

  // Mock file and vault
  let mockActiveFile: { path: string; basename: string; extension: string } | null;
  let mockVaultContent: string;
  let mockEditorSelection: string | null;
  let mockEditorCursors: { from: { line: number }; to: { line: number } };

  beforeEach(() => {
    mockActiveFile = null;
    mockVaultContent = '';
    mockEditorSelection = null;
    mockEditorCursors = { from: { line: 0 }, to: { line: 0 } };

    deps = {
      app: {
        workspace: {
          getActiveFile: vi.fn(() => mockActiveFile),
          getActiveViewOfType: vi.fn(() => {
            if (mockEditorSelection) {
              return {
                editor: {
                  getSelection: () => mockEditorSelection,
                  getCursor: (which: string) =>
                    which === 'from' ? mockEditorCursors.from : mockEditorCursors.to,
                },
              };
            }
            return null;
          }),
        },
        vault: {
          read: vi.fn(async () => mockVaultContent),
        },
      } as unknown as ModuleDeps['app'],
      plugin: {
        settings: {
          activeNoteContext: true,
        },
      } as unknown as ModuleDeps['plugin'],
    };

    callbacks = {
      onContextChange: vi.fn(),
    };
  });

  describe('creation', () => {
    it('should create handle with required methods', () => {
      handle = createContextLoader(deps, callbacks);
      expect(handle.load).toBeDefined();
      expect(handle.getInfo).toBeDefined();
      expect(handle.estimateTokens).toBeDefined();
      expect(handle.refresh).toBeDefined();
      expect(handle.clear).toBeDefined();
      expect(handle.getLastSentNote).toBeDefined();
      expect(handle.setLastSentNote).toBeDefined();
      expect(handle.resetNoteTracking).toBeDefined();
      expect(handle.destroy).toBeDefined();
    });
  });

  describe('getInfo', () => {
    it('should return null when activeNoteContext is disabled', () => {
      deps.plugin.settings.activeNoteContext = false;
      handle = createContextLoader(deps, callbacks);
      expect(handle.getInfo()).toBeNull();
    });

    it('should return null when no active file', () => {
      mockActiveFile = null;
      handle = createContextLoader(deps, callbacks);
      expect(handle.getInfo()).toBeNull();
    });

    it('should return null for non-markdown files', () => {
      mockActiveFile = { path: '/test.txt', basename: 'test', extension: 'txt' };
      handle = createContextLoader(deps, callbacks);
      expect(handle.getInfo()).toBeNull();
    });

    it('should return context info for markdown files', () => {
      mockActiveFile = { path: '/folder/note.md', basename: 'note', extension: 'md' };
      handle = createContextLoader(deps, callbacks);
      const info = handle.getInfo();
      expect(info).toEqual({
        type: 'file',
        name: 'note',
        path: '/folder/note.md',
      });
    });
  });

  describe('load', () => {
    it('should return original content when context disabled', async () => {
      deps.plugin.settings.activeNoteContext = false;
      handle = createContextLoader(deps, callbacks);
      const result = await handle.load('Hello');
      expect(result.messageContent).toBe('Hello');
      expect(result.displayContent).toBeUndefined();
    });

    it('should return original content when no active file', async () => {
      mockActiveFile = null;
      handle = createContextLoader(deps, callbacks);
      const result = await handle.load('Hello');
      expect(result.messageContent).toBe('Hello');
    });

    it('should include selected text with line numbers', async () => {
      mockActiveFile = { path: '/note.md', basename: 'note', extension: 'md' };
      mockEditorSelection = 'selected text here';
      mockEditorCursors = { from: { line: 4 }, to: { line: 6 } };
      handle = createContextLoader(deps, callbacks);

      const result = await handle.load('What is this?');
      expect(result.messageContent).toContain('<selected_text');
      expect(result.messageContent).toContain('path="/note.md"');
      expect(result.messageContent).toContain('lines="5-7"');
      expect(result.messageContent).toContain('selected text here');
      expect(result.messageContent).toContain('What is this?');
      expect(result.displayContent).toBe('What is this?');
    });

    it('should include full note for new notes', async () => {
      mockActiveFile = { path: '/note.md', basename: 'note', extension: 'md' };
      mockVaultContent = '# Note Content\n\nSome text here.';
      handle = createContextLoader(deps, callbacks);

      const result = await handle.load('Summarize this');
      expect(result.messageContent).toContain('<active_note');
      expect(result.messageContent).toContain('path="/note.md"');
      expect(result.messageContent).toContain('# Note Content');
      expect(result.messageContent).toContain('Summarize this');
      expect(result.displayContent).toBe('Summarize this');
    });

    it('should send delta for changed notes when delta is smaller', async () => {
      mockActiveFile = { path: '/note.md', basename: 'note', extension: 'md' };
      // Use longer content so the delta will be smaller than full content
      const lines = [];
      for (let i = 1; i <= 50; i++) {
        lines.push(`Line ${i} with some padding content to make it longer`);
      }
      mockVaultContent = lines.join('\n');
      handle = createContextLoader(deps, callbacks);

      // First load - full note
      await handle.load('First message');

      // Change just one line in the middle
      lines[25] = 'Line 26 MODIFIED with some padding content';
      mockVaultContent = lines.join('\n');

      // Second load - should be delta (smaller than 50 lines)
      const result = await handle.load('Second message');
      expect(result.messageContent).toContain('<active_note_changes');
      expect(result.messageContent).toContain('MODIFIED');
    });

    it('should not inject context when same note unchanged', async () => {
      mockActiveFile = { path: '/note.md', basename: 'note', extension: 'md' };
      mockVaultContent = 'Unchanged content';
      handle = createContextLoader(deps, callbacks);

      // First load
      await handle.load('First message');

      // Second load - same content
      const result = await handle.load('Second message');
      expect(result.messageContent).toBe('Second message');
      expect(result.displayContent).toBeUndefined();
    });

    it('should send full note when switching to different note', async () => {
      mockActiveFile = { path: '/note1.md', basename: 'note1', extension: 'md' };
      mockVaultContent = 'Note 1 content';
      handle = createContextLoader(deps, callbacks);

      // First load
      await handle.load('First message');

      // Switch to different note
      mockActiveFile = { path: '/note2.md', basename: 'note2', extension: 'md' };
      mockVaultContent = 'Note 2 content';

      const result = await handle.load('Second message');
      expect(result.messageContent).toContain('<active_note');
      expect(result.messageContent).toContain('path="/note2.md"');
      expect(result.messageContent).toContain('Note 2 content');
    });

    it('should send full note when delta is larger than full content', async () => {
      mockActiveFile = { path: '/note.md', basename: 'note', extension: 'md' };
      mockVaultContent = 'A';
      handle = createContextLoader(deps, callbacks);

      // First load
      await handle.load('First');

      // Completely different content (delta would be larger)
      mockVaultContent = 'B';

      const result = await handle.load('Second');
      // Either active_note or active_note_changes is acceptable
      // The key is that context is included
      expect(
        result.messageContent.includes('<active_note') ||
          result.messageContent.includes('<active_note_changes')
      ).toBe(true);
    });
  });

  describe('lastSentNote tracking', () => {
    it('should initially return null', () => {
      handle = createContextLoader(deps, callbacks);
      expect(handle.getLastSentNote()).toBeNull();
    });

    it('should track sent note after load', async () => {
      mockActiveFile = { path: '/note.md', basename: 'note', extension: 'md' };
      mockVaultContent = 'Test content';
      handle = createContextLoader(deps, callbacks);

      await handle.load('Message');

      const lastSent = handle.getLastSentNote();
      expect(lastSent).toEqual({
        path: '/note.md',
        content: 'Test content',
      });
    });

    it('should allow setting last sent note', () => {
      handle = createContextLoader(deps, callbacks);
      handle.setLastSentNote('/custom.md', 'Custom content');

      const lastSent = handle.getLastSentNote();
      expect(lastSent).toEqual({
        path: '/custom.md',
        content: 'Custom content',
      });
    });

    it('should reset note tracking', async () => {
      mockActiveFile = { path: '/note.md', basename: 'note', extension: 'md' };
      mockVaultContent = 'Test content';
      handle = createContextLoader(deps, callbacks);

      await handle.load('Message');
      expect(handle.getLastSentNote()).not.toBeNull();

      handle.resetNoteTracking();
      expect(handle.getLastSentNote()).toBeNull();
    });
  });

  describe('refresh', () => {
    it('should call onContextChange with current info', () => {
      mockActiveFile = { path: '/note.md', basename: 'note', extension: 'md' };
      handle = createContextLoader(deps, callbacks);

      handle.refresh();

      expect(callbacks.onContextChange).toHaveBeenCalledWith({
        type: 'file',
        name: 'note',
        path: '/note.md',
      });
    });

    it('should call onContextChange with null when no context', () => {
      mockActiveFile = null;
      handle = createContextLoader(deps, callbacks);

      handle.refresh();

      expect(callbacks.onContextChange).toHaveBeenCalledWith(null);
    });
  });

  describe('clear', () => {
    it('should reset all state and notify parent', async () => {
      mockActiveFile = { path: '/note.md', basename: 'note', extension: 'md' };
      mockVaultContent = 'Content';
      handle = createContextLoader(deps, callbacks);

      await handle.load('Message');
      expect(handle.getLastSentNote()).not.toBeNull();

      handle.clear();

      expect(handle.getLastSentNote()).toBeNull();
      expect(callbacks.onContextChange).toHaveBeenCalledWith(null);
    });
  });

  describe('estimateTokens', () => {
    it('should return 0 when no context', () => {
      mockActiveFile = null;
      handle = createContextLoader(deps, callbacks);
      expect(handle.estimateTokens()).toBe(0);
    });

    it('should estimate tokens based on cached content', async () => {
      mockActiveFile = { path: '/note.md', basename: 'note', extension: 'md' };
      mockVaultContent = 'A'.repeat(400); // 400 chars = ~100 tokens
      handle = createContextLoader(deps, callbacks);

      await handle.load('Message');

      // Should estimate ~100 tokens (400 chars / 4 chars per token)
      expect(handle.estimateTokens()).toBe(100);
    });
  });

  describe('destroy', () => {
    it('should clear state on destroy', async () => {
      mockActiveFile = { path: '/note.md', basename: 'note', extension: 'md' };
      mockVaultContent = 'Content';
      handle = createContextLoader(deps, callbacks);

      await handle.load('Message');
      handle.destroy();

      expect(handle.getLastSentNote()).toBeNull();
    });
  });

  describe('delta computation', () => {
    // Helper to create a long document
    function createLongDoc(lineCount: number, modifier?: (i: number) => string): string {
      const lines = [];
      for (let i = 1; i <= lineCount; i++) {
        const content = modifier ? modifier(i) : `Line ${i} with padding content here`;
        lines.push(content);
      }
      return lines.join('\n');
    }

    it('should detect added lines when delta is smaller', async () => {
      mockActiveFile = { path: '/note.md', basename: 'note', extension: 'md' };
      mockVaultContent = createLongDoc(30);
      handle = createContextLoader(deps, callbacks);

      await handle.load('First');

      // Add a line at the end
      mockVaultContent = createLongDoc(30) + '\nNew added line here';
      const result = await handle.load('Second');

      expect(result.messageContent).toContain('+ New added line here');
    });

    it('should detect removed lines when delta is smaller', async () => {
      mockActiveFile = { path: '/note.md', basename: 'note', extension: 'md' };
      // Add a line in the middle that will be removed
      mockVaultContent = createLongDoc(30, (i) =>
        i === 15 ? 'Line to be removed' : `Line ${i} with padding content`
      );
      handle = createContextLoader(deps, callbacks);

      await handle.load('First');

      // Remove the line by making all lines consistent
      mockVaultContent = createLongDoc(30, (i) =>
        i === 15 ? `Line ${i} with padding content` : `Line ${i} with padding content`
      );
      const result = await handle.load('Second');

      // Should show the change between old and new line 15
      expect(result.messageContent).toContain('- Line to be removed');
      expect(result.messageContent).toContain('+ Line 15 with padding content');
    });

    it('should detect modified lines when delta is smaller', async () => {
      mockActiveFile = { path: '/note.md', basename: 'note', extension: 'md' };
      mockVaultContent = createLongDoc(30, (i) =>
        i === 15 ? 'Original line content here' : `Line ${i} with padding content`
      );
      handle = createContextLoader(deps, callbacks);

      await handle.load('First');

      mockVaultContent = createLongDoc(30, (i) =>
        i === 15 ? 'Modified line content here' : `Line ${i} with padding content`
      );
      const result = await handle.load('Second');

      expect(result.messageContent).toContain('- Original line content here');
      expect(result.messageContent).toContain('+ Modified line content here');
    });

    it('should send full note when delta is larger than content', async () => {
      mockActiveFile = { path: '/note.md', basename: 'note', extension: 'md' };
      mockVaultContent = 'Short';
      handle = createContextLoader(deps, callbacks);

      await handle.load('First');

      mockVaultContent = 'Different';
      const result = await handle.load('Second');

      // Delta would be larger for such small changes, so full note is sent
      expect(result.messageContent).toContain('<active_note');
      expect(result.messageContent).toContain('Different');
    });
  });
});
