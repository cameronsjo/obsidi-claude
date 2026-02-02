/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSlashCommands,
  type SlashCommandsHandle,
  type SlashCommandsCallbacks,
  type SkillInfo,
} from '../../src/chatView/slashCommands';
import type { ModuleDeps } from '../../src/chatView/types';
import type { ChatViewCommandContext } from '../../src/chatViewCommands';

// Mock the chatViewCommands module
vi.mock('../../src/chatViewCommands', () => ({
  executeCommand: vi.fn().mockResolvedValue(false),
  getCommandList: vi.fn(() => [
    { name: '/clear', description: 'Clear messages' },
    { name: '/new', description: 'New conversation' },
    { name: '/help', description: 'Show help' },
  ]),
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

describe('SlashCommands', () => {
  let deps: ModuleDeps;
  let callbacks: SlashCommandsCallbacks;
  let handle: SlashCommandsHandle;
  let renderedMessages: Array<{ id: string; role: string; content: string }>;

  beforeEach(() => {
    renderedMessages = [];

    deps = {
      app: {} as ModuleDeps['app'],
      plugin: {} as ModuleDeps['plugin'],
    };

    callbacks = {
      getCommandContext: vi.fn(() => ({
        plugin: deps.plugin,
        conversation: { id: 'test', title: 'Test', messages: [], createdAt: 0, updatedAt: 0 },
        inputEl: document.createElement('textarea'),
        messagesContainer: document.createElement('div'),
        getMessageQueue: vi.fn(() => []),
        isSearchVisible: vi.fn(() => false),
        showTemporaryStatus: vi.fn(),
        setStatus: vi.fn(),
        renderAllMessages: vi.fn(),
        scrollToBottom: vi.fn(),
        clearMessages: vi.fn(),
        newConversation: vi.fn(),
        toggleSearch: vi.fn(),
        clearQueue: vi.fn(),
        performSearch: vi.fn(),
        addTagToConversation: vi.fn(),
        removeTagFromConversation: vi.fn(),
        saveConversation: vi.fn(),
        exportConversation: vi.fn(),
        exportToClipboard: vi.fn(),
        exportToJson: vi.fn(),
        resizeInput: vi.fn(),
        focusInput: vi.fn(),
      } as ChatViewCommandContext)),
      renderMessage: vi.fn((msg) => {
        renderedMessages.push(msg);
      }),
      scrollToBottom: vi.fn(),
      showTemporaryStatus: vi.fn(),
      toggleHistory: vi.fn().mockResolvedValue(undefined),
      togglePin: vi.fn().mockResolvedValue(undefined),
      renameConversation: vi.fn(),
      showStats: vi.fn(),
      showUsageDashboard: vi.fn().mockResolvedValue(undefined),
      copyToClipboard: vi.fn().mockResolvedValue(undefined),
      handleToolsCommand: vi.fn().mockResolvedValue(undefined),
      handleContextCommand: vi.fn().mockResolvedValue(undefined),
      handleDuplicateCommand: vi.fn().mockResolvedValue(undefined),
      showBookmarks: vi.fn(),
      handlePromptsCommand: vi.fn().mockResolvedValue(undefined),
      handleUndoCommand: vi.fn().mockResolvedValue(undefined),
      handleBudgetCommand: vi.fn().mockResolvedValue(undefined),
      showCostSummary: vi.fn(),
      generateNote: vi.fn().mockResolvedValue(undefined),
      handleModeCommand: vi.fn().mockResolvedValue(undefined),
      handleMcpCommand: vi.fn().mockResolvedValue(undefined),
      handleExtractCommand: vi.fn().mockResolvedValue(undefined),
      handleAnalyzeCommand: vi.fn().mockResolvedValue(undefined),
      getSkills: vi.fn(() => [] as SkillInfo[]),
      skillsEnabled: vi.fn(() => true),
      getSkillsFolderPath: vi.fn(() => 'skills'),
    };

    handle = createSlashCommands(deps, callbacks);
  });

  describe('creation', () => {
    it('should create a slash commands handle', () => {
      expect(handle).toBeDefined();
      expect(handle.process).toBeDefined();
      expect(handle.getCommands).toBeDefined();
      expect(handle.showHelp).toBeDefined();
      expect(handle.showSkillsList).toBeDefined();
      expect(handle.destroy).toBeDefined();
    });
  });

  describe('getCommands', () => {
    it('should return list of commands', () => {
      const commands = handle.getCommands();
      expect(commands).toBeInstanceOf(Array);
      expect(commands.length).toBeGreaterThan(0);
      expect(commands[0]).toHaveProperty('name');
      expect(commands[0]).toHaveProperty('description');
    });
  });

  describe('process', () => {
    it('should handle /history command', async () => {
      const result = await handle.process('/history');
      expect(result).toBe(true);
      expect(callbacks.toggleHistory).toHaveBeenCalled();
    });

    it('should handle /pin command', async () => {
      const result = await handle.process('/pin');
      expect(result).toBe(true);
      expect(callbacks.togglePin).toHaveBeenCalled();
    });

    it('should handle /rename command with args', async () => {
      const result = await handle.process('/rename New Title');
      expect(result).toBe(true);
      expect(callbacks.renameConversation).toHaveBeenCalledWith('New Title');
    });

    it('should handle /rename command without args', async () => {
      const result = await handle.process('/rename');
      expect(result).toBe(true);
      expect(callbacks.renameConversation).toHaveBeenCalledWith(undefined);
    });

    it('should handle /stats command', async () => {
      const result = await handle.process('/stats');
      expect(result).toBe(true);
      expect(callbacks.showStats).toHaveBeenCalled();
    });

    it('should handle /usage command', async () => {
      const result = await handle.process('/usage');
      expect(result).toBe(true);
      expect(callbacks.showUsageDashboard).toHaveBeenCalled();
    });

    it('should handle /copy command', async () => {
      const result = await handle.process('/copy');
      expect(result).toBe(true);
      expect(callbacks.copyToClipboard).toHaveBeenCalled();
    });

    it('should handle /tools command', async () => {
      const result = await handle.process('/tools show');
      expect(result).toBe(true);
      expect(callbacks.handleToolsCommand).toHaveBeenCalledWith('show');
    });

    it('should handle /context command', async () => {
      const result = await handle.process('/context on');
      expect(result).toBe(true);
      expect(callbacks.handleContextCommand).toHaveBeenCalledWith('on');
    });

    it('should handle /duplicate command', async () => {
      const result = await handle.process('/duplicate');
      expect(result).toBe(true);
      expect(callbacks.handleDuplicateCommand).toHaveBeenCalled();
    });

    it('should handle /fork command (alias for duplicate)', async () => {
      const result = await handle.process('/fork');
      expect(result).toBe(true);
      expect(callbacks.handleDuplicateCommand).toHaveBeenCalled();
    });

    it('should handle /bookmarks command', async () => {
      const result = await handle.process('/bookmarks');
      expect(result).toBe(true);
      expect(callbacks.showBookmarks).toHaveBeenCalled();
    });

    it('should handle /help command', async () => {
      const result = await handle.process('/help');
      expect(result).toBe(true);
      expect(callbacks.renderMessage).toHaveBeenCalled();
      expect(renderedMessages[0].content).toContain('Conversation:');
    });

    it('should handle /? command (alias for help)', async () => {
      const result = await handle.process('/?');
      expect(result).toBe(true);
      expect(callbacks.renderMessage).toHaveBeenCalled();
    });

    it('should handle /prompts command', async () => {
      const result = await handle.process('/prompts list');
      expect(result).toBe(true);
      expect(callbacks.handlePromptsCommand).toHaveBeenCalledWith('list');
    });

    it('should handle /undo command', async () => {
      const result = await handle.process('/undo --dry-run');
      expect(result).toBe(true);
      expect(callbacks.handleUndoCommand).toHaveBeenCalledWith('--dry-run');
    });

    it('should handle /budget command', async () => {
      const result = await handle.process('/budget set 5.00');
      expect(result).toBe(true);
      expect(callbacks.handleBudgetCommand).toHaveBeenCalledWith('set 5.00');
    });

    it('should handle /cost command', async () => {
      const result = await handle.process('/cost');
      expect(result).toBe(true);
      expect(callbacks.showCostSummary).toHaveBeenCalled();
    });

    it('should handle /savenote command', async () => {
      const result = await handle.process('/savenote q-and-a notes/test.md');
      expect(result).toBe(true);
      expect(callbacks.generateNote).toHaveBeenCalledWith('q-and-a notes/test.md');
    });

    it('should handle /skills command', async () => {
      const result = await handle.process('/skills');
      expect(result).toBe(true);
      // Skills are empty, so should show status message
      expect(callbacks.showTemporaryStatus).toHaveBeenCalled();
    });

    it('should handle /mode command', async () => {
      const result = await handle.process('/mode acceptEdits');
      expect(result).toBe(true);
      expect(callbacks.handleModeCommand).toHaveBeenCalledWith('acceptEdits');
    });

    it('should handle /mcp command', async () => {
      const result = await handle.process('/mcp status');
      expect(result).toBe(true);
      expect(callbacks.handleMcpCommand).toHaveBeenCalledWith('status');
    });

    it('should handle /extract command', async () => {
      const result = await handle.process('/extract');
      expect(result).toBe(true);
      expect(callbacks.handleExtractCommand).toHaveBeenCalledWith('');
    });

    it('should handle /analyze command', async () => {
      const result = await handle.process('/analyze');
      expect(result).toBe(true);
      expect(callbacks.handleAnalyzeCommand).toHaveBeenCalledWith('');
    });

    it('should handle unknown command', async () => {
      const result = await handle.process('/unknown');
      expect(result).toBe(true);
      expect(callbacks.showTemporaryStatus).toHaveBeenCalledWith(
        expect.stringContaining('Unknown command'),
        'info'
      );
    });

    it('should be case insensitive for commands', async () => {
      const result = await handle.process('/HISTORY');
      expect(result).toBe(true);
      expect(callbacks.toggleHistory).toHaveBeenCalled();
    });
  });

  describe('showHelp', () => {
    it('should render help message', () => {
      handle.showHelp();
      expect(callbacks.renderMessage).toHaveBeenCalled();
      expect(renderedMessages.length).toBe(1);
      expect(renderedMessages[0].role).toBe('assistant');
      expect(renderedMessages[0].content).toContain('/new');
      expect(renderedMessages[0].content).toContain('/clear');
    });

    it('should scroll to bottom after showing help', () => {
      handle.showHelp();
      expect(callbacks.scrollToBottom).toHaveBeenCalledWith(true);
    });

    it('should include all command sections', () => {
      handle.showHelp();
      const content = renderedMessages[0].content;
      expect(content).toContain('**Conversation:**');
      expect(content).toContain('**Tags:**');
      expect(content).toContain('**Settings:**');
      expect(content).toContain('**Context:**');
      expect(content).toContain('**Skills:**');
      expect(content).toContain('**Shortcuts:**');
    });
  });

  describe('showSkillsList', () => {
    it('should show message when skills disabled', () => {
      callbacks.skillsEnabled = vi.fn(() => false);
      handle.showSkillsList();
      expect(callbacks.showTemporaryStatus).toHaveBeenCalledWith(
        'Skills are disabled. Enable them in settings.',
        'info',
        3000
      );
    });

    it('should show message when no skills found', () => {
      callbacks.getSkills = vi.fn(() => []);
      handle.showSkillsList();
      expect(callbacks.showTemporaryStatus).toHaveBeenCalledWith(
        expect.stringContaining('No skills found'),
        'info',
        3000
      );
    });

    it('should render skills list when skills exist', () => {
      const mockSkills: SkillInfo[] = [
        { name: 'Test Skill', description: 'A test skill', triggers: ['test'], alwaysActive: false },
        { name: 'Always Active', description: 'Always on', triggers: [], alwaysActive: true },
      ];
      callbacks.getSkills = vi.fn(() => mockSkills);

      handle.showSkillsList();

      expect(callbacks.renderMessage).toHaveBeenCalled();
      expect(renderedMessages[0].content).toContain('Test Skill');
      expect(renderedMessages[0].content).toContain('Always Active');
      expect(renderedMessages[0].content).toContain('**Always Active:**');
      expect(renderedMessages[0].content).toContain('**Triggered by Keywords:**');
    });

    it('should show skill triggers', () => {
      const mockSkills: SkillInfo[] = [
        { name: 'Test', description: 'Test', triggers: ['foo', 'bar', 'baz'], alwaysActive: false },
      ];
      callbacks.getSkills = vi.fn(() => mockSkills);

      handle.showSkillsList();

      expect(renderedMessages[0].content).toContain('foo, bar, baz');
    });

    it('should truncate triggers list when too long', () => {
      const mockSkills: SkillInfo[] = [
        { name: 'Test', description: 'Test', triggers: ['a', 'b', 'c', 'd', 'e'], alwaysActive: false },
      ];
      callbacks.getSkills = vi.fn(() => mockSkills);

      handle.showSkillsList();

      expect(renderedMessages[0].content).toContain('+2 more');
    });

    it('should scroll to bottom after showing skills', () => {
      const mockSkills: SkillInfo[] = [
        { name: 'Test', description: 'Test', triggers: [], alwaysActive: true },
      ];
      callbacks.getSkills = vi.fn(() => mockSkills);

      handle.showSkillsList();

      expect(callbacks.scrollToBottom).toHaveBeenCalledWith(true);
    });
  });

  describe('destroy', () => {
    it('should not throw on destroy', () => {
      expect(() => handle.destroy()).not.toThrow();
    });
  });
});
