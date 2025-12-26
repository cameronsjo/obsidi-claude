import type { App } from 'obsidian';
import type { ObsidiClaudeSettings, Conversation } from './types';
import { DEFAULT_SETTINGS, generateId } from './types';
import * as fs from 'fs';
import * as path from 'path';

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
    await this.ensureDir(this.basePath);
    await this.ensureDir(this.conversationsPath);
    await this.ensureDir(this.vectorsPath);
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
        return this.mergeSettings(saved);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
    return { ...DEFAULT_SETTINGS };
  }

  async saveSettings(settings: ObsidiClaudeSettings): Promise<void> {
    const filePath = path.join(this.basePath, 'settings.json');
    try {
      await this.ensureDir(this.basePath);
      fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw error;
    }
  }

  private mergeSettings(saved: Partial<ObsidiClaudeSettings>): ObsidiClaudeSettings {
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      embedding: {
        ...DEFAULT_SETTINGS.embedding,
        ...(saved.embedding || {}),
      },
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
  }>> {
    const indexPath = path.join(this.conversationsPath, 'index.json');
    try {
      if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('Failed to load conversation index:', error);
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
      console.error('Failed to load current conversation pointer:', error);
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
        return JSON.parse(content) as Conversation;
      }
    } catch (error) {
      console.error(`Failed to load conversation ${id}:`, error);
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

    // Update the index
    const index = await this.listConversations();
    const existing = index.findIndex((c) => c.id === conversation.id);

    const meta = {
      id: conversation.id,
      title: conversation.title,
      messageCount: conversation.messages.length,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };

    if (existing >= 0) {
      index[existing] = meta;
    } else {
      index.unshift(meta); // Add to beginning
    }

    // Sort by updatedAt descending
    index.sort((a, b) => b.updatedAt - a.updatedAt);

    await this.saveConversationIndex(index);
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(id: string): Promise<void> {
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
    const settings = await this.loadSettings();
    const conversationList = await this.listConversations();
    const conversations: Conversation[] = [];

    for (const meta of conversationList) {
      const conv = await this.loadConversation(meta.id);
      if (conv) {
        conversations.push(conv);
      }
    }

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

    return { settingsImported, conversationsImported };
  }

  /**
   * Clear all data
   */
  async clearAll(): Promise<void> {
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
  }
}
