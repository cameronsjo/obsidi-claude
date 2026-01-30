import type { App } from 'obsidian';
import type { ObsidiClaudeSettings, Conversation } from './types';
import {
  DEFAULT_SETTINGS,
  DEFAULT_EMBEDDING_SETTINGS,
  DEFAULT_MCP_SETTINGS,
  DEFAULT_SKILL_SETTINGS,
  DEFAULT_AGENT_SETTINGS,
  generateId,
} from './types';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from './logger';

const log = createLogger('StorageService');

/**
 * Handles all plugin data persistence in .obsidian/plugins/obsidi-claude/
 *
 * Directory structure:
 * .obsidian/plugins/obsidi-claude/
 * ├── data.json              (Obsidian's default - we use for settings)
 * ├── conversations/
 * │   ├── index.json         (list of conversations with metadata)
 * │   ├── {id}.json          (individual conversation files)
 * │   └── current.json       (pointer to current conversation)
 * └── vectors/
 *     └── index.json         (vector embeddings index)
 */
export class StorageService {
  private app: App;
  private basePath: string;
  private conversationsPath: string;
  private vectorsPath: string;

  constructor(app: App) {
    this.app = app;

    // Get vault path
    const adapter = app.vault.adapter as unknown as { basePath?: string };
    const vaultPath = adapter.basePath || '';

    this.basePath = path.join(vaultPath, '.obsidian', 'plugins', 'obsidi-claude');
    this.conversationsPath = path.join(this.basePath, 'conversations');
    this.vectorsPath = path.join(this.basePath, 'vectors');
  }

  /**
   * Initialize storage directories
   */
  async initialize(): Promise<void> {
    log.info('Initializing storage directories', { basePath: this.basePath });
    await this.ensureDir(this.basePath);
    await this.ensureDir(this.conversationsPath);
    await this.ensureDir(this.vectorsPath);
    log.debug('Storage directories initialized');
  }

  private async ensureDir(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
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
      await this.ensureDir(this.basePath);
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
      mcp: { ...DEFAULT_MCP_SETTINGS, ...(saved.mcp || {}) },
      skills: { ...DEFAULT_SKILL_SETTINGS, ...(saved.skills || {}) },
      agents: { ...DEFAULT_AGENT_SETTINGS, ...(saved.agents || {}) },
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
  }>> {
    const indexPath = path.join(this.conversationsPath, 'index.json');
    try {
      if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath, 'utf-8');
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
    }>
  ): Promise<void> {
    const indexPath = path.join(this.conversationsPath, 'index.json');
    fs.writeFileSync(indexPath, JSON.stringify(conversations, null, 2));
  }

  /**
   * Get current conversation ID
   */
  async getCurrentConversationId(): Promise<string | null> {
    const currentPath = path.join(this.conversationsPath, 'current.json');
    try {
      if (fs.existsSync(currentPath)) {
        const content = fs.readFileSync(currentPath, 'utf-8');
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
    const currentPath = path.join(this.conversationsPath, 'current.json');
    await this.ensureDir(this.conversationsPath);
    fs.writeFileSync(currentPath, JSON.stringify({ id }));
  }

  /**
   * Load a specific conversation
   */
  async loadConversation(id: string): Promise<Conversation | null> {
    const filePath = path.join(this.conversationsPath, `${id}.json`);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
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
    await this.ensureDir(this.conversationsPath);

    // Save the conversation file
    const filePath = path.join(this.conversationsPath, `${conversation.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2));
    log.debug('Saved conversation', { id: conversation.id, messageCount: conversation.messages.length });

    // Update the index
    const index = await this.listConversations();
    const existing = index.findIndex((c) => c.id === conversation.id);

    const meta = {
      id: conversation.id,
      title: conversation.title,
      messageCount: conversation.messages.length,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      tags: conversation.tags,
      pinned: conversation.pinned,
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
    const filePath = path.join(this.conversationsPath, `${id}.json`);

    // Delete the file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

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

    // No current conversation, create one
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

  // ==================== MCP Sessions ====================

  /**
   * Load stale MCP session IDs (sessions that existed before last restart)
   */
  loadStaleSessionIds(): Set<string> {
    const filePath = path.join(this.basePath, 'mcp-sessions.json');
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content) as { sessionIds: string[]; savedAt: number };
        log.debug('Loaded stale MCP session IDs', { count: data.sessionIds.length });
        return new Set(data.sessionIds);
      }
    } catch (error) {
      log.error('Failed to load stale MCP session IDs', error);
    }
    return new Set();
  }

  /**
   * Save active MCP session IDs (called before server stop)
   */
  saveSessionIds(sessionIds: string[]): void {
    const filePath = path.join(this.basePath, 'mcp-sessions.json');
    try {
      fs.writeFileSync(filePath, JSON.stringify({
        sessionIds,
        savedAt: Date.now(),
      }, null, 2));
      log.debug('Saved MCP session IDs', { count: sessionIds.length });
    } catch (error) {
      log.error('Failed to save MCP session IDs', error);
    }
  }

  /**
   * Clear saved MCP session IDs
   */
  clearSessionIds(): void {
    const filePath = path.join(this.basePath, 'mcp-sessions.json');
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        log.debug('Cleared MCP session IDs');
      }
    } catch (error) {
      log.error('Failed to clear MCP session IDs', error);
    }
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
