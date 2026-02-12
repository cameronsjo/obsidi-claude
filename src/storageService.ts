import type { App } from 'obsidian';
import type { ObsidiClaudeSettings, Conversation, ConversationStorageSettings } from './types';
import {
  DEFAULT_SETTINGS,
  DEFAULT_EMBEDDING_SETTINGS,
  DEFAULT_SKILL_SETTINGS,
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_CONVERSATION_STORAGE_SETTINGS,
  generateId,
} from './types';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from './logger';

const log = createLogger('StorageService');

/**
 * Handles all plugin data persistence.
 *
 * Supports two storage modes:
 * 1. Plugin storage (default): .obsidian/plugins/obsidi-claude/conversations/
 * 2. Vault storage (opt-in): {configurable folder}/  (enables Obsidian Sync)
 *
 * Directory structure (both modes):
 * {base}/
 * ├── index.json         (list of conversations with metadata)
 * ├── {id}.json          (individual conversation files)
 * └── current.json       (pointer to current conversation)
 */
export class StorageService {
  private app: App;
  private basePath: string;
  private pluginConversationsPath: string;
  private vectorsPath: string;
  private storageSettings: ConversationStorageSettings = DEFAULT_CONVERSATION_STORAGE_SETTINGS;

  constructor(app: App) {
    this.app = app;

    // Get vault path for plugin storage
    const adapter = app.vault.adapter as unknown as { basePath?: string };
    const vaultPath = adapter.basePath || '';

    this.basePath = path.join(vaultPath, '.obsidian', 'plugins', 'obsidi-claude');
    this.pluginConversationsPath = path.join(this.basePath, 'conversations');
    this.vectorsPath = path.join(this.basePath, 'vectors');
  }

  /**
   * Update storage settings (called when settings change).
   */
  setStorageSettings(settings: ConversationStorageSettings): void {
    this.storageSettings = settings;
    log.debug('Storage settings updated', {
      enabled: settings.enabled,
      folderPath: settings.folderPath,
    });
  }

  /**
   * Check if vault storage is enabled.
   */
  isVaultStorageEnabled(): boolean {
    return this.storageSettings.enabled;
  }

  /**
   * Get the conversations folder path based on current settings.
   * Returns vault-relative path for vault storage, absolute path for plugin storage.
   */
  private getConversationsPath(): string {
    if (this.storageSettings.enabled) {
      return this.storageSettings.folderPath;
    }
    return this.pluginConversationsPath;
  }

  /**
   * Initialize storage directories
   */
  async initialize(): Promise<void> {
    log.info('Initializing storage directories', { basePath: this.basePath });
    await this.ensureDirFs(this.basePath);
    await this.ensureDirFs(this.pluginConversationsPath);
    await this.ensureDirFs(this.vectorsPath);
    log.debug('Storage directories initialized');
  }

  /**
   * Ensure vault storage directory exists.
   */
  async ensureVaultStorageDir(): Promise<void> {
    if (!this.storageSettings.enabled) return;

    const folderPath = this.storageSettings.folderPath;
    if (!(await this.app.vault.adapter.exists(folderPath))) {
      await this.app.vault.adapter.mkdir(folderPath);
      log.info('Created vault storage directory', { folderPath });
    }
  }

  private async ensureDirFs(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  // ==================== Abstracted File I/O ====================

  /**
   * Read a file from the appropriate storage location.
   */
  private async readConversationFile(filename: string): Promise<string | null> {
    if (this.storageSettings.enabled) {
      // Vault storage - use Obsidian adapter
      const filePath = `${this.storageSettings.folderPath}/${filename}`;
      try {
        if (await this.app.vault.adapter.exists(filePath)) {
          return await this.app.vault.adapter.read(filePath);
        }
      } catch (error) {
        log.error('Failed to read vault file', error, { filePath });
      }
      return null;
    } else {
      // Plugin storage - use Node.js fs
      const filePath = path.join(this.pluginConversationsPath, filename);
      try {
        if (fs.existsSync(filePath)) {
          return fs.readFileSync(filePath, 'utf-8');
        }
      } catch (error) {
        log.error('Failed to read plugin file', error, { filePath });
      }
      return null;
    }
  }

  /**
   * Write a file to the appropriate storage location.
   */
  private async writeConversationFile(filename: string, content: string): Promise<void> {
    if (this.storageSettings.enabled) {
      // Vault storage - use Obsidian adapter
      await this.ensureVaultStorageDir();
      const filePath = `${this.storageSettings.folderPath}/${filename}`;
      await this.app.vault.adapter.write(filePath, content);
    } else {
      // Plugin storage - use Node.js fs
      await this.ensureDirFs(this.pluginConversationsPath);
      const filePath = path.join(this.pluginConversationsPath, filename);
      fs.writeFileSync(filePath, content);
    }
  }

  /**
   * Delete a file from the appropriate storage location.
   */
  private async deleteConversationFile(filename: string): Promise<void> {
    if (this.storageSettings.enabled) {
      // Vault storage
      const filePath = `${this.storageSettings.folderPath}/${filename}`;
      try {
        if (await this.app.vault.adapter.exists(filePath)) {
          await this.app.vault.adapter.remove(filePath);
        }
      } catch (error) {
        log.error('Failed to delete vault file', error, { filePath });
      }
    } else {
      // Plugin storage
      const filePath = path.join(this.pluginConversationsPath, filename);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        log.error('Failed to delete plugin file', error, { filePath });
      }
    }
  }

  // ==================== Settings ====================

  async loadSettings(): Promise<ObsidiClaudeSettings> {
    const filePath = path.join(this.basePath, 'settings.json');
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const saved = JSON.parse(content) as Partial<ObsidiClaudeSettings>;
        log.debug('Settings loaded from file');
        return this.mergeSettings(saved);
      }
    } catch (error) {
      log.error('Failed to load settings', error);
    }
    log.debug('Using default settings');
    return { ...DEFAULT_SETTINGS };
  }

  async saveSettings(settings: ObsidiClaudeSettings): Promise<void> {
    const filePath = path.join(this.basePath, 'settings.json');
    try {
      await this.ensureDirFs(this.basePath);
      fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
      log.debug('Settings saved');
    } catch (error) {
      log.error('Failed to save settings', error);
      throw error;
    }
  }

  private mergeSettings(saved: Partial<ObsidiClaudeSettings>): ObsidiClaudeSettings {
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      embedding: { ...DEFAULT_EMBEDDING_SETTINGS, ...(saved.embedding || {}) },
      skills: { ...DEFAULT_SKILL_SETTINGS, ...(saved.skills || {}) },
      agents: { ...DEFAULT_AGENT_SETTINGS, ...(saved.agents || {}) },
      conversationStorage: { ...DEFAULT_CONVERSATION_STORAGE_SETTINGS, ...(saved.conversationStorage || {}) },
    };
  }

  // ==================== Conversations ====================

  /**
   * Get list of all conversations (metadata only)
   */
  async listConversations(): Promise<Array<{
    id: string;
    title: string;
    messageCount: number;
    createdAt: number;
    updatedAt: number;
    tags?: string[];
    pinned?: boolean;
    preview?: string;
  }>> {
    try {
      const content = await this.readConversationFile('index.json');
      if (content) {
        const conversations = JSON.parse(content);
        log.debug('Loaded conversation index', { count: conversations.length });
        return conversations;
      }
    } catch (error) {
      log.error('Failed to load conversation index', error);
    }
    return [];
  }

  private async saveConversationIndex(
    conversations: Array<{
      id: string;
      title: string;
      messageCount: number;
      createdAt: number;
      updatedAt: number;
      tags?: string[];
      pinned?: boolean;
      preview?: string;
    }>
  ): Promise<void> {
    await this.writeConversationFile('index.json', JSON.stringify(conversations, null, 2));
  }

  /**
   * Get current conversation ID
   */
  async getCurrentConversationId(): Promise<string | null> {
    try {
      const content = await this.readConversationFile('current.json');
      if (content) {
        const data = JSON.parse(content);
        return data.id || null;
      }
    } catch (error) {
      log.error('Failed to load current conversation pointer', error);
    }
    return null;
  }

  /**
   * Set current conversation ID
   */
  async setCurrentConversationId(id: string | null): Promise<void> {
    await this.writeConversationFile('current.json', JSON.stringify({ id }));
  }

  /**
   * Load a specific conversation
   */
  async loadConversation(id: string): Promise<Conversation | null> {
    try {
      const content = await this.readConversationFile(`${id}.json`);
      if (content) {
        const conversation = JSON.parse(content) as Conversation;
        log.debug('Loaded conversation', { id, messageCount: conversation.messages.length });
        return conversation;
      }
    } catch (error) {
      log.error('Failed to load conversation', error, { id });
    }
    return null;
  }

  /**
   * Save a conversation
   */
  async saveConversation(conversation: Conversation): Promise<void> {
    // Save the conversation file
    await this.writeConversationFile(`${conversation.id}.json`, JSON.stringify(conversation, null, 2));
    log.debug('Saved conversation', { id: conversation.id, messageCount: conversation.messages.length });

    // Update the index
    const index = await this.listConversations();
    const existing = index.findIndex((c) => c.id === conversation.id);

    // Extract preview from last assistant message (truncated)
    const lastAssistantMsg = [...conversation.messages]
      .reverse()
      .find(m => m.role === 'assistant' && m.content);
    const preview = lastAssistantMsg?.content
      ? lastAssistantMsg.content.slice(0, 100).replace(/\s+/g, ' ').trim() +
        (lastAssistantMsg.content.length > 100 ? '...' : '')
      : undefined;

    const meta = {
      id: conversation.id,
      title: conversation.title,
      messageCount: conversation.messages.length,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      tags: conversation.tags,
      pinned: conversation.pinned,
      preview,
    };

    if (existing >= 0) {
      index[existing] = meta;
    } else {
      index.unshift(meta); // Add to beginning
    }

    // Sort: pinned first, then by updatedAt descending
    index.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt - a.updatedAt;
    });

    await this.saveConversationIndex(index);
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(id: string): Promise<void> {
    log.info('Deleting conversation', { id });

    // Delete the file
    await this.deleteConversationFile(`${id}.json`);

    // Update the index
    const index = await this.listConversations();
    const filtered = index.filter((c) => c.id !== id);
    await this.saveConversationIndex(filtered);

    // Clear current if it was this one
    const currentId = await this.getCurrentConversationId();
    if (currentId === id) {
      await this.setCurrentConversationId(null);
    }
  }

  /**
   * Create a new conversation
   */
  async createConversation(title = 'New Conversation'): Promise<Conversation> {
    const conversation: Conversation = {
      id: generateId(),
      title,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    log.info('Creating new conversation', { id: conversation.id, title });
    await this.saveConversation(conversation);
    await this.setCurrentConversationId(conversation.id);

    return conversation;
  }

  /**
   * Get or create the current conversation
   */
  async getCurrentConversation(): Promise<Conversation> {
    const currentId = await this.getCurrentConversationId();

    if (currentId) {
      const conversation = await this.loadConversation(currentId);
      if (conversation) {
        return conversation;
      }
    }

    // No current conversation - check if auto-resume is enabled
    if (this.storageSettings.autoResume) {
      const conversations = await this.listConversations();
      if (conversations.length > 0) {
        // Load the most recent conversation
        const mostRecent = conversations[0]; // Already sorted by updatedAt
        const conversation = await this.loadConversation(mostRecent.id);
        if (conversation) {
          await this.setCurrentConversationId(conversation.id);
          log.info('Auto-resumed conversation', { id: conversation.id, title: conversation.title });
          return conversation;
        }
      }
    }

    // No conversation to resume, create new one
    return this.createConversation();
  }

  /**
   * Rename a conversation
   */
  async renameConversation(id: string, newTitle: string): Promise<boolean> {
    const conversation = await this.loadConversation(id);
    if (!conversation) {
      log.warn('Cannot rename: conversation not found', { id });
      return false;
    }

    conversation.title = newTitle;
    conversation.updatedAt = Date.now();
    await this.saveConversation(conversation);
    log.info('Renamed conversation', { id, newTitle });
    return true;
  }

  /**
   * Toggle pin status of a conversation
   */
  async togglePin(id: string): Promise<boolean> {
    const conversation = await this.loadConversation(id);
    if (!conversation) {
      log.warn('Cannot toggle pin: conversation not found', { id });
      return false;
    }

    conversation.pinned = !conversation.pinned;
    conversation.updatedAt = Date.now();
    await this.saveConversation(conversation);
    log.info('Toggled pin status', { id, pinned: conversation.pinned });
    return conversation.pinned ?? false;
  }

  /**
   * Update tags on a conversation
   */
  async updateTags(id: string, tags: string[]): Promise<boolean> {
    const conversation = await this.loadConversation(id);
    if (!conversation) {
      log.warn('Cannot update tags: conversation not found', { id });
      return false;
    }

    conversation.tags = tags;
    conversation.updatedAt = Date.now();
    await this.saveConversation(conversation);
    log.info('Updated conversation tags', { id, tags });
    return true;
  }

  /**
   * Get all unique tags across conversations
   */
  async getAllTags(): Promise<string[]> {
    const conversations = await this.listConversations();
    const tagSet = new Set<string>();
    for (const conv of conversations) {
      if (conv.tags) {
        for (const tag of conv.tags) {
          tagSet.add(tag);
        }
      }
    }
    return Array.from(tagSet).sort();
  }

  /**
   * Duplicate a conversation (for branching/forking)
   */
  async duplicateConversation(id: string): Promise<Conversation | null> {
    const original = await this.loadConversation(id);
    if (!original) {
      log.warn('Cannot duplicate: conversation not found', { id });
      return null;
    }

    const duplicate: Conversation = {
      id: generateId(),
      title: `${original.title} (copy)`,
      messages: original.messages.map(m => ({ ...m, id: generateId() })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: original.tags ? [...original.tags] : undefined,
      pinned: false, // Don't copy pin status
      metadata: {
        backendType: original.metadata?.backendType ?? 'api',
        // Don't copy session ID - new conversation
      },
    };

    await this.saveConversation(duplicate);
    log.info('Duplicated conversation', { originalId: id, newId: duplicate.id });
    return duplicate;
  }

  // ==================== Migration ====================

  /**
   * Migrate conversations from plugin storage to vault storage.
   * Called when vault storage is enabled for the first time.
   */
  async migrateToVaultStorage(): Promise<{ migrated: number; failed: number }> {
    log.info('Starting migration to vault storage');

    // Temporarily disable vault storage to read from plugin storage
    const targetPath = this.storageSettings.folderPath;
    this.storageSettings.enabled = false;

    const conversations = await this.listConversations();
    const currentId = await this.getCurrentConversationId();

    // Re-enable vault storage for writing
    this.storageSettings.enabled = true;

    let migrated = 0;
    let failed = 0;

    // Ensure vault directory exists
    await this.ensureVaultStorageDir();

    // Migrate each conversation
    for (const meta of conversations) {
      try {
        // Read from plugin storage
        this.storageSettings.enabled = false;
        const conversation = await this.loadConversation(meta.id);
        this.storageSettings.enabled = true;

        if (conversation) {
          // Write to vault storage
          await this.saveConversation(conversation);
          migrated++;
          log.debug('Migrated conversation', { id: meta.id, title: meta.title });
        } else {
          failed++;
          log.warn('Failed to load conversation for migration', { id: meta.id });
        }
      } catch (error) {
        failed++;
        log.error('Failed to migrate conversation', error, { id: meta.id });
      }
    }

    // Migrate current pointer
    if (currentId) {
      await this.setCurrentConversationId(currentId);
    }

    log.info('Migration complete', { migrated, failed, targetPath });
    return { migrated, failed };
  }

  /**
   * Check if plugin storage has conversations that could be migrated.
   */
  async hasPluginStorageConversations(): Promise<boolean> {
    const indexPath = path.join(this.pluginConversationsPath, 'index.json');
    try {
      if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath, 'utf-8');
        const conversations = JSON.parse(content);
        return conversations.length > 0;
      }
    } catch {
      // Ignore errors
    }
    return false;
  }

  /**
   * Generate a title from the first message
   */
  generateTitle(firstMessage: string): string {
    // Take first 50 chars, trim, and clean up
    let title = firstMessage.slice(0, 50).trim();

    // Remove newlines
    title = title.replace(/\n/g, ' ');

    // Add ellipsis if truncated
    if (firstMessage.length > 50) {
      title += '...';
    }

    return title || 'New Conversation';
  }

  // ==================== Vectors ====================

  getVectorsPath(): string {
    return this.vectorsPath;
  }

  // ==================== Export/Import ====================

  /**
   * Export all data as a single JSON object
   */
  async exportAll(): Promise<{
    settings: ObsidiClaudeSettings;
    conversations: Conversation[];
    exportedAt: string;
  }> {
    log.info('Exporting all data');
    const settings = await this.loadSettings();
    const conversationList = await this.listConversations();
    const conversations: Conversation[] = [];

    for (const meta of conversationList) {
      const conv = await this.loadConversation(meta.id);
      if (conv) {
        conversations.push(conv);
      }
    }

    log.info('Export completed', { conversationCount: conversations.length });
    return {
      settings,
      conversations,
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Import data from an export
   */
  async importAll(data: {
    settings?: ObsidiClaudeSettings;
    conversations?: Conversation[];
  }): Promise<{ settingsImported: boolean; conversationsImported: number }> {
    log.info('Importing data', {
      hasSettings: !!data.settings,
      conversationCount: data.conversations?.length ?? 0,
    });

    let settingsImported = false;
    let conversationsImported = 0;

    if (data.settings) {
      await this.saveSettings(this.mergeSettings(data.settings));
      settingsImported = true;
    }

    if (data.conversations) {
      for (const conv of data.conversations) {
        await this.saveConversation(conv);
        conversationsImported++;
      }
    }

    log.info('Import completed', { settingsImported, conversationsImported });
    return { settingsImported, conversationsImported };
  }

  /**
   * Clear all data
   */
  async clearAll(): Promise<void> {
    log.warn('Clearing all data');
    // Clear conversations
    const conversations = await this.listConversations();
    for (const conv of conversations) {
      await this.deleteConversation(conv.id);
    }

    // Clear vectors
    const vectorIndexPath = path.join(this.vectorsPath, 'index.json');
    if (fs.existsSync(vectorIndexPath)) {
      fs.unlinkSync(vectorIndexPath);
    }
    log.info('All data cleared', { conversationsDeleted: conversations.length });
  }
}
