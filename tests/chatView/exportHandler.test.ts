/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createExportHandler,
  type ExportHandlerHandle,
  type ExportHandlerCallbacks,
  type ExportedConversation,
} from '../../src/chatView/exportHandler';
import type { ModuleDeps, Conversation, ChatMessage } from '../../src/chatView/types';

// Mock clipboard API
const mockClipboard = {
  writeText: vi.fn(),
  readText: vi.fn(),
};
Object.defineProperty(navigator, 'clipboard', {
  value: mockClipboard,
  writable: true,
});

// Mock vault operations
const mockVault = {
  getAbstractFileByPath: vi.fn(),
  createFolder: vi.fn(),
  create: vi.fn(),
  modify: vi.fn(),
};

describe('ExportHandler', () => {
  let deps: ModuleDeps;
  let callbacks: ExportHandlerCallbacks;
  let handle: ExportHandlerHandle;
  let mockConversation: Conversation;

  function createMessage(
    role: 'user' | 'assistant',
    content: string,
    id = 'msg-1'
  ): ChatMessage {
    return {
      id,
      role,
      content,
      timestamp: Date.now(),
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();

    mockConversation = {
      id: 'conv-1',
      title: 'Test Conversation',
      messages: [
        createMessage('user', 'Hello Claude', 'msg-1'),
        createMessage('assistant', 'Hello! How can I help?', 'msg-2'),
      ],
      createdAt: Date.parse('2024-01-15T10:00:00Z'),
      updatedAt: Date.parse('2024-01-15T10:05:00Z'),
    };

    deps = {
      app: {
        vault: mockVault,
      } as unknown as ModuleDeps['app'],
      plugin: {} as ModuleDeps['plugin'],
    };

    callbacks = {
      getConversation: vi.fn(() => mockConversation),
      getModel: vi.fn(() => 'claude-3-opus'),
      showStatus: vi.fn(),
      setStatus: vi.fn(),
    };
  });

  afterEach(() => {
    handle?.destroy();
  });

  describe('toMarkdown', () => {
    it('should include frontmatter with title and date', () => {
      handle = createExportHandler(deps, callbacks);
      const md = handle.toMarkdown();

      expect(md).toContain('---');
      expect(md).toContain('title: "Test Conversation"');
      expect(md).toContain('date:');
      expect(md).toContain('tags:');
      expect(md).toContain('- claude-chat');
    });

    it('should include conversation title as h1', () => {
      handle = createExportHandler(deps, callbacks);
      const md = handle.toMarkdown();

      expect(md).toContain('# Test Conversation');
    });

    it('should format user messages with You label', () => {
      handle = createExportHandler(deps, callbacks);
      const md = handle.toMarkdown();

      expect(md).toContain('### **You**');
      expect(md).toContain('Hello Claude');
    });

    it('should format assistant messages with Claude label', () => {
      handle = createExportHandler(deps, callbacks);
      const md = handle.toMarkdown();

      expect(md).toContain('### **Claude**');
      expect(md).toContain('Hello! How can I help?');
    });

    it('should include message timestamps', () => {
      handle = createExportHandler(deps, callbacks);
      const md = handle.toMarkdown();

      // Should contain time format like *10:00* or similar
      expect(md).toMatch(/\*\d{1,2}:\d{2}\s*(AM|PM)?\*/i);
    });

    it('should include tool calls when present', () => {
      mockConversation.messages[1].toolCalls = [
        { name: 'read_file', input: { path: '/test.md' }, result: 'File contents here' },
      ];
      handle = createExportHandler(deps, callbacks);
      const md = handle.toMarkdown();

      expect(md).toContain('<details>');
      expect(md).toContain('<summary>Tool calls</summary>');
      expect(md).toContain('**read_file**');
      expect(md).toContain('File contents here');
    });

    it('should truncate long tool results', () => {
      const longResult = 'x'.repeat(300);
      mockConversation.messages[1].toolCalls = [
        { name: 'read_file', input: {}, result: longResult },
      ];
      handle = createExportHandler(deps, callbacks);
      const md = handle.toMarkdown();

      expect(md).toContain('...');
      expect(md).not.toContain(longResult);
    });

    it('should handle empty conversation', () => {
      mockConversation.messages = [];
      handle = createExportHandler(deps, callbacks);
      const md = handle.toMarkdown();

      expect(md).toContain('# Test Conversation');
      expect(md).not.toContain('**You**');
      expect(md).not.toContain('**Claude**');
    });
  });

  describe('toJSON', () => {
    it('should return valid JSON string', () => {
      handle = createExportHandler(deps, callbacks);
      const json = handle.toJSON();

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should include conversation metadata', () => {
      handle = createExportHandler(deps, callbacks);
      const parsed = JSON.parse(handle.toJSON()) as ExportedConversation;

      expect(parsed.id).toBe('conv-1');
      expect(parsed.title).toBe('Test Conversation');
      expect(parsed.createdAt).toBe(mockConversation.createdAt);
      expect(parsed.model).toBe('claude-3-opus');
    });

    it('should include exportedAt timestamp', () => {
      const before = Date.now();
      handle = createExportHandler(deps, callbacks);
      const parsed = JSON.parse(handle.toJSON()) as ExportedConversation;
      const after = Date.now();

      expect(parsed.exportedAt).toBeGreaterThanOrEqual(before);
      expect(parsed.exportedAt).toBeLessThanOrEqual(after);
    });

    it('should include all messages', () => {
      handle = createExportHandler(deps, callbacks);
      const parsed = JSON.parse(handle.toJSON()) as ExportedConversation;

      expect(parsed.messages).toHaveLength(2);
      expect(parsed.messages[0].role).toBe('user');
      expect(parsed.messages[0].content).toBe('Hello Claude');
      expect(parsed.messages[1].role).toBe('assistant');
      expect(parsed.messages[1].content).toBe('Hello! How can I help?');
    });

    it('should include tool calls in messages', () => {
      mockConversation.messages[1].toolCalls = [
        { name: 'read_file', input: { path: '/test.md' }, result: 'content' },
      ];
      handle = createExportHandler(deps, callbacks);
      const parsed = JSON.parse(handle.toJSON()) as ExportedConversation;

      expect(parsed.messages[1].toolCalls).toBeDefined();
      expect(parsed.messages[1].toolCalls?.[0].name).toBe('read_file');
    });
  });

  describe('copyToClipboard', () => {
    it('should copy markdown to clipboard', async () => {
      handle = createExportHandler(deps, callbacks);
      await handle.copyToClipboard();

      expect(mockClipboard.writeText).toHaveBeenCalledOnce();
      const copied = mockClipboard.writeText.mock.calls[0][0] as string;
      expect(copied).toContain('# Test Conversation');
      expect(copied).toContain('Hello Claude');
    });

    it('should show success status', async () => {
      handle = createExportHandler(deps, callbacks);
      await handle.copyToClipboard();

      expect(callbacks.showStatus).toHaveBeenCalledWith(
        'Copied to clipboard',
        'success',
        2000
      );
    });

    it('should show info when no messages', async () => {
      mockConversation.messages = [];
      handle = createExportHandler(deps, callbacks);
      await handle.copyToClipboard();

      expect(mockClipboard.writeText).not.toHaveBeenCalled();
      expect(callbacks.showStatus).toHaveBeenCalledWith(
        'No messages to export',
        'info',
        2000
      );
    });
  });

  describe('downloadMarkdown', () => {
    it('should create export folder if needed', async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      handle = createExportHandler(deps, callbacks);
      await handle.downloadMarkdown();

      expect(mockVault.createFolder).toHaveBeenCalledWith('Claude Exports');
    });

    it('should not create folder if exists', async () => {
      mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'Claude Exports') return { path };
        return null;
      });
      handle = createExportHandler(deps, callbacks);
      await handle.downloadMarkdown();

      expect(mockVault.createFolder).not.toHaveBeenCalled();
    });

    it('should create new file when not exists', async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      handle = createExportHandler(deps, callbacks);
      await handle.downloadMarkdown();

      expect(mockVault.create).toHaveBeenCalledWith(
        expect.stringContaining('Claude Exports/Claude Chat - '),
        expect.stringContaining('# Test Conversation')
      );
    });

    it('should modify existing file', async () => {
      const existingFile = { path: 'Claude Exports/Claude Chat - Test Conversation.md' };
      mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path.endsWith('.md')) return existingFile;
        return null;
      });
      handle = createExportHandler(deps, callbacks);
      await handle.downloadMarkdown();

      expect(mockVault.modify).toHaveBeenCalledWith(
        existingFile,
        expect.stringContaining('# Test Conversation')
      );
    });

    it('should sanitize filename', async () => {
      mockConversation.title = 'Test: With/Special*Chars?';
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      handle = createExportHandler(deps, callbacks);
      await handle.downloadMarkdown();

      expect(mockVault.create).toHaveBeenCalledWith(
        'Claude Exports/Claude Chat - Test- With-Special-Chars-.md',
        expect.any(String)
      );
    });

    it('should truncate long titles in filename', async () => {
      mockConversation.title = 'A'.repeat(100);
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      handle = createExportHandler(deps, callbacks);
      await handle.downloadMarkdown();

      const createCall = mockVault.create.mock.calls[0] as [string, string];
      const filename = createCall[0];
      expect(filename.length).toBeLessThan(100);
    });

    it('should show success status', async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      handle = createExportHandler(deps, callbacks);
      await handle.downloadMarkdown();

      expect(callbacks.showStatus).toHaveBeenCalledWith(
        expect.stringContaining('Exported to'),
        'success'
      );
    });

    it('should show error on failure', async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      mockVault.create.mockRejectedValue(new Error('Write failed'));
      handle = createExportHandler(deps, callbacks);
      await handle.downloadMarkdown();

      expect(callbacks.setStatus).toHaveBeenCalledWith('Export failed', 'error');
    });

    it('should show info when no messages', async () => {
      mockConversation.messages = [];
      handle = createExportHandler(deps, callbacks);
      await handle.downloadMarkdown();

      expect(mockVault.create).not.toHaveBeenCalled();
      expect(callbacks.showStatus).toHaveBeenCalledWith(
        'No messages to export',
        'info',
        2000
      );
    });
  });

  describe('downloadJSON', () => {
    it('should create JSON file', async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      handle = createExportHandler(deps, callbacks);
      await handle.downloadJSON();

      expect(mockVault.create).toHaveBeenCalledWith(
        expect.stringContaining('.json'),
        expect.stringContaining('"id": "conv-1"')
      );
    });

    it('should show success status with JSON mention', async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      handle = createExportHandler(deps, callbacks);
      await handle.downloadJSON();

      expect(callbacks.showStatus).toHaveBeenCalledWith(
        expect.stringContaining('Exported JSON'),
        'success'
      );
    });

    it('should show info when no messages', async () => {
      mockConversation.messages = [];
      handle = createExportHandler(deps, callbacks);
      await handle.downloadJSON();

      expect(mockVault.create).not.toHaveBeenCalled();
      expect(callbacks.showStatus).toHaveBeenCalledWith(
        'No messages to export',
        'info',
        2000
      );
    });
  });

  describe('handleExportCommand', () => {
    beforeEach(() => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
    });

    it('should default to markdown export', async () => {
      handle = createExportHandler(deps, callbacks);
      await handle.handleExportCommand('');

      expect(mockVault.create).toHaveBeenCalledWith(
        expect.stringContaining('.md'),
        expect.any(String)
      );
    });

    it('should handle "markdown" format', async () => {
      handle = createExportHandler(deps, callbacks);
      await handle.handleExportCommand('markdown');

      expect(mockVault.create).toHaveBeenCalledWith(
        expect.stringContaining('.md'),
        expect.any(String)
      );
    });

    it('should handle "md" format', async () => {
      handle = createExportHandler(deps, callbacks);
      await handle.handleExportCommand('md');

      expect(mockVault.create).toHaveBeenCalledWith(
        expect.stringContaining('.md'),
        expect.any(String)
      );
    });

    it('should handle "json" format', async () => {
      handle = createExportHandler(deps, callbacks);
      await handle.handleExportCommand('json');

      expect(mockVault.create).toHaveBeenCalledWith(
        expect.stringContaining('.json'),
        expect.any(String)
      );
    });

    it('should handle "clipboard" format', async () => {
      handle = createExportHandler(deps, callbacks);
      await handle.handleExportCommand('clipboard');

      expect(mockClipboard.writeText).toHaveBeenCalled();
    });

    it('should handle "copy" format', async () => {
      handle = createExportHandler(deps, callbacks);
      await handle.handleExportCommand('copy');

      expect(mockClipboard.writeText).toHaveBeenCalled();
    });

    it('should be case-insensitive', async () => {
      handle = createExportHandler(deps, callbacks);
      await handle.handleExportCommand('JSON');

      expect(mockVault.create).toHaveBeenCalledWith(
        expect.stringContaining('.json'),
        expect.any(String)
      );
    });

    it('should trim whitespace', async () => {
      handle = createExportHandler(deps, callbacks);
      await handle.handleExportCommand('  json  ');

      expect(mockVault.create).toHaveBeenCalledWith(
        expect.stringContaining('.json'),
        expect.any(String)
      );
    });

    it('should show error for unknown format', async () => {
      handle = createExportHandler(deps, callbacks);
      await handle.handleExportCommand('pdf');

      expect(callbacks.showStatus).toHaveBeenCalledWith(
        'Unknown format. Use: /export [clipboard|json|markdown]',
        'info',
        3000
      );
    });

    it('should show info when no messages', async () => {
      mockConversation.messages = [];
      handle = createExportHandler(deps, callbacks);
      await handle.handleExportCommand('json');

      expect(mockVault.create).not.toHaveBeenCalled();
      expect(callbacks.showStatus).toHaveBeenCalledWith(
        'No messages to export',
        'info',
        2000
      );
    });
  });

  describe('destruction', () => {
    it('should destroy without error', () => {
      handle = createExportHandler(deps, callbacks);
      expect(() => handle.destroy()).not.toThrow();
    });
  });
});
