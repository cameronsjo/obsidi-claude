import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StorageService } from '../src/StorageService';
import { DEFAULT_SETTINGS, type Conversation, type ChatMessage } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Create a mock App
function createMockApp(basePath: string) {
  return {
    vault: {
      adapter: {
        basePath,
      },
    },
  } as any;
}

describe('StorageService', () => {
  let tempDir: string;
  let storage: StorageService;
  let pluginPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
    const mockApp = createMockApp(tempDir);
    storage = new StorageService(mockApp);
    pluginPath = path.join(tempDir, '.obsidian', 'plugins', 'obsidi-claude');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('should create storage directories', async () => {
      await storage.initialize();

      expect(fs.existsSync(pluginPath)).toBe(true);
      expect(fs.existsSync(path.join(pluginPath, 'conversations'))).toBe(true);
      expect(fs.existsSync(path.join(pluginPath, 'vectors'))).toBe(true);
    });

    it('should be idempotent', async () => {
      await storage.initialize();
      await storage.initialize();

      expect(fs.existsSync(pluginPath)).toBe(true);
    });
  });

  describe('Settings', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should return default settings when none saved', async () => {
      const settings = await storage.loadSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it('should save and load settings', async () => {
      const customSettings = {
        ...DEFAULT_SETTINGS,
        model: 'claude-opus-4' as const,
        maxTurns: 100,
      };

      await storage.saveSettings(customSettings);
      const loaded = await storage.loadSettings();

      expect(loaded.model).toBe('claude-opus-4');
      expect(loaded.maxTurns).toBe(100);
    });

    it('should merge partial settings with defaults', async () => {
      // Save partial settings
      const settingsPath = path.join(pluginPath, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ model: 'claude-opus-4' }));

      const settings = await storage.loadSettings();

      expect(settings.model).toBe('claude-opus-4');
      expect(settings.maxTurns).toBe(DEFAULT_SETTINGS.maxTurns);
      expect(settings.embedding).toEqual(DEFAULT_SETTINGS.embedding);
    });

    it('should merge nested embedding settings', async () => {
      const settingsPath = path.join(pluginPath, 'settings.json');
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          embedding: { enabled: true, chunkSize: 1024 },
        })
      );

      const settings = await storage.loadSettings();

      expect(settings.embedding.enabled).toBe(true);
      expect(settings.embedding.chunkSize).toBe(1024);
      expect(settings.embedding.provider).toBe(DEFAULT_SETTINGS.embedding.provider);
    });

    it('should handle corrupted settings file', async () => {
      const settingsPath = path.join(pluginPath, 'settings.json');
      fs.writeFileSync(settingsPath, 'not valid json{{{');

      const settings = await storage.loadSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe('Conversations', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    describe('createConversation', () => {
      it('should create a new conversation', async () => {
        const conv = await storage.createConversation('Test Title');

        expect(conv.id).toBeDefined();
        expect(conv.title).toBe('Test Title');
        expect(conv.messages).toEqual([]);
        expect(conv.createdAt).toBeLessThanOrEqual(Date.now());
      });

      it('should set as current conversation', async () => {
        const conv = await storage.createConversation();
        const currentId = await storage.getCurrentConversationId();

        expect(currentId).toBe(conv.id);
      });

      it('should add to conversation index', async () => {
        await storage.createConversation('First');
        await storage.createConversation('Second');

        const list = await storage.listConversations();
        expect(list).toHaveLength(2);
      });
    });

    describe('saveConversation', () => {
      it('should save conversation to file', async () => {
        const conv = await storage.createConversation();
        conv.messages.push({
          id: 'msg1',
          role: 'user',
          content: 'Hello',
          timestamp: Date.now(),
        });

        await storage.saveConversation(conv);
        const loaded = await storage.loadConversation(conv.id);

        expect(loaded?.messages).toHaveLength(1);
        expect(loaded?.messages[0].content).toBe('Hello');
      });

      it('should update message count in index', async () => {
        const conv = await storage.createConversation();
        conv.messages.push({
          id: 'msg1',
          role: 'user',
          content: 'Hello',
          timestamp: Date.now(),
        });

        await storage.saveConversation(conv);
        const list = await storage.listConversations();

        expect(list[0].messageCount).toBe(1);
      });

      it('should sort index by updatedAt', async () => {
        const conv1 = await storage.createConversation('First');
        await new Promise((r) => setTimeout(r, 50));
        const conv2 = await storage.createConversation('Second');

        // Update first conversation with a future timestamp
        await new Promise((r) => setTimeout(r, 50));
        conv1.updatedAt = Date.now();
        await storage.saveConversation(conv1);

        const list = await storage.listConversations();
        expect(list[0].id).toBe(conv1.id);
      });
    });

    describe('loadConversation', () => {
      it('should load existing conversation', async () => {
        const created = await storage.createConversation('Test');
        const loaded = await storage.loadConversation(created.id);

        expect(loaded?.title).toBe('Test');
      });

      it('should return null for non-existent conversation', async () => {
        const loaded = await storage.loadConversation('nonexistent-id');
        expect(loaded).toBeNull();
      });
    });

    describe('deleteConversation', () => {
      it('should delete conversation file', async () => {
        const conv = await storage.createConversation();
        await storage.deleteConversation(conv.id);

        const loaded = await storage.loadConversation(conv.id);
        expect(loaded).toBeNull();
      });

      it('should remove from index', async () => {
        const conv = await storage.createConversation();
        await storage.deleteConversation(conv.id);

        const list = await storage.listConversations();
        expect(list.find((c) => c.id === conv.id)).toBeUndefined();
      });

      it('should clear current if deleting current conversation', async () => {
        const conv = await storage.createConversation();
        await storage.deleteConversation(conv.id);

        const currentId = await storage.getCurrentConversationId();
        expect(currentId).toBeNull();
      });

      it('should not affect current if deleting different conversation', async () => {
        const conv1 = await storage.createConversation('First');
        const conv2 = await storage.createConversation('Second');

        await storage.deleteConversation(conv1.id);

        const currentId = await storage.getCurrentConversationId();
        expect(currentId).toBe(conv2.id);
      });
    });

    describe('listConversations', () => {
      it('should return empty array when no conversations', async () => {
        const list = await storage.listConversations();
        expect(list).toEqual([]);
      });

      it('should return metadata for all conversations', async () => {
        await storage.createConversation('First');
        await storage.createConversation('Second');
        await storage.createConversation('Third');

        const list = await storage.listConversations();
        expect(list).toHaveLength(3);
        expect(list.every((c) => c.id && c.title && c.createdAt)).toBe(true);
      });
    });

    describe('getCurrentConversation', () => {
      it('should return current conversation if exists', async () => {
        const created = await storage.createConversation('Test');
        const current = await storage.getCurrentConversation();

        expect(current.id).toBe(created.id);
      });

      it('should create new conversation if none exists', async () => {
        const conv = await storage.getCurrentConversation();
        expect(conv.id).toBeDefined();
        expect(conv.title).toBe('New Conversation');
      });

      it('should create new if current ID points to deleted conversation', async () => {
        const conv = await storage.createConversation();
        // Manually delete file but leave current pointer
        fs.unlinkSync(path.join(pluginPath, 'conversations', `${conv.id}.json`));

        const current = await storage.getCurrentConversation();
        expect(current.id).not.toBe(conv.id);
      });
    });
  });

  describe('generateTitle', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should truncate long messages', () => {
      const longMessage = 'a'.repeat(100);
      const title = storage.generateTitle(longMessage);

      expect(title.length).toBeLessThanOrEqual(53); // 50 + '...'
      expect(title.endsWith('...')).toBe(true);
    });

    it('should not add ellipsis for short messages', () => {
      const title = storage.generateTitle('Hello');
      expect(title).toBe('Hello');
      expect(title.endsWith('...')).toBe(false);
    });

    it('should remove newlines', () => {
      const title = storage.generateTitle('Line 1\nLine 2\nLine 3');
      expect(title).toBe('Line 1 Line 2 Line 3');
    });

    it('should return default for empty message', () => {
      const title = storage.generateTitle('');
      expect(title).toBe('New Conversation');
    });

    it('should trim whitespace', () => {
      const title = storage.generateTitle('  Hello World  ');
      expect(title).toBe('Hello World');
    });
  });

  describe('Export/Import', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should export all data', async () => {
      await storage.saveSettings({ ...DEFAULT_SETTINGS, maxTurns: 75 });
      const conv = await storage.createConversation('Test Conv');
      conv.messages.push({
        id: 'msg1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      });
      await storage.saveConversation(conv);

      const exported = await storage.exportAll();

      expect(exported.settings.maxTurns).toBe(75);
      expect(exported.conversations).toHaveLength(1);
      expect(exported.conversations[0].messages).toHaveLength(1);
      expect(exported.exportedAt).toBeDefined();
    });

    it('should import settings', async () => {
      await storage.importAll({
        settings: { ...DEFAULT_SETTINGS, maxTurns: 99 },
      });

      const settings = await storage.loadSettings();
      expect(settings.maxTurns).toBe(99);
    });

    it('should import conversations', async () => {
      const conv: Conversation = {
        id: 'imported-id',
        title: 'Imported',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = await storage.importAll({ conversations: [conv] });

      expect(result.conversationsImported).toBe(1);
      const loaded = await storage.loadConversation('imported-id');
      expect(loaded?.title).toBe('Imported');
    });

    it('should return import counts', async () => {
      const result = await storage.importAll({
        settings: DEFAULT_SETTINGS,
        conversations: [
          { id: '1', title: 'A', messages: [], createdAt: 0, updatedAt: 0 },
          { id: '2', title: 'B', messages: [], createdAt: 0, updatedAt: 0 },
        ],
      });

      expect(result.settingsImported).toBe(true);
      expect(result.conversationsImported).toBe(2);
    });
  });

  describe('clearAll', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should delete all conversations', async () => {
      await storage.createConversation('One');
      await storage.createConversation('Two');
      await storage.createConversation('Three');

      await storage.clearAll();

      const list = await storage.listConversations();
      expect(list).toHaveLength(0);
    });

    it('should delete vector index', async () => {
      const vectorsPath = storage.getVectorsPath();
      const indexPath = path.join(vectorsPath, 'index.json');
      fs.writeFileSync(indexPath, '{}');

      await storage.clearAll();

      expect(fs.existsSync(indexPath)).toBe(false);
    });
  });

  describe('getVectorsPath', () => {
    it('should return correct vectors path', async () => {
      await storage.initialize();
      const vectorsPath = storage.getVectorsPath();

      expect(vectorsPath).toContain('vectors');
      expect(fs.existsSync(vectorsPath)).toBe(true);
    });
  });
});

describe('StorageService edge cases', () => {
  let tempDir: string;
  let storage: StorageService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-edge-'));
    const mockApp = createMockApp(tempDir);
    storage = new StorageService(mockApp);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should handle missing vault path gracefully', () => {
    const mockApp = createMockApp('');
    const emptyStorage = new StorageService(mockApp);

    // Should not throw
    expect(emptyStorage.getVectorsPath()).toContain('vectors');
  });

  it('should handle sequential batch creates', async () => {
    await storage.initialize();

    // Create multiple conversations sequentially (concurrent writes have race conditions)
    for (let i = 0; i < 10; i++) {
      await storage.createConversation(`Conv ${i}`);
    }

    const list = await storage.listConversations();
    expect(list).toHaveLength(10);
  });
});
