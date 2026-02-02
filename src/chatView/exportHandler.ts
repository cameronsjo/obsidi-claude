/**
 * Export handler module for ChatView.
 * Handles exporting conversations to various formats (markdown, JSON, clipboard).
 */
import type { TFile } from 'obsidian';
import type { ModuleDeps, ModuleHandle, Conversation, ChatMessage } from './types';
import { createLogger } from '../logger';

const log = createLogger('ExportHandler');

/**
 * Data structure for JSON export.
 */
export interface ExportedConversation {
  id: string;
  title: string;
  createdAt: number;
  exportedAt: number;
  model: string;
  messages: Array<{
    id: string;
    role: ChatMessage['role'];
    content: string;
    timestamp: number;
    toolCalls?: ChatMessage['toolCalls'];
  }>;
}

/**
 * Callbacks for export handler to communicate with parent.
 */
export interface ExportHandlerCallbacks {
  /** Get the current conversation */
  getConversation: () => Conversation;
  /** Get the current model name */
  getModel: () => string;
  /** Show temporary status message */
  showStatus: (msg: string, type: 'info' | 'error' | 'success', duration?: number) => void;
  /** Set status (without auto-clear) */
  setStatus: (msg: string, type: 'info' | 'error' | 'success') => void;
}

/**
 * Handle for controlling the export handler.
 */
export interface ExportHandlerHandle extends ModuleHandle {
  /** Convert conversation to markdown format */
  toMarkdown(): string;
  /** Convert conversation to JSON string */
  toJSON(): string;
  /** Copy conversation to clipboard as markdown */
  copyToClipboard(): Promise<void>;
  /** Export conversation to markdown file in vault */
  downloadMarkdown(): Promise<void>;
  /** Export conversation to JSON file in vault */
  downloadJSON(): Promise<void>;
  /** Handle /export command with format argument */
  handleExportCommand(args: string): Promise<void>;
}

/**
 * Create an export handler for a conversation.
 * @param deps - Module dependencies (app, plugin)
 * @param callbacks - Callbacks for parent communication
 */
export function createExportHandler(
  deps: ModuleDeps,
  callbacks: ExportHandlerCallbacks
): ExportHandlerHandle {
  const { app } = deps;

  /**
   * Convert conversation to markdown format (simple, for clipboard).
   */
  function toMarkdownSimple(): string {
    const conversation = callbacks.getConversation();
    const lines: string[] = [];
    lines.push(`# ${conversation.title}`);
    lines.push('');

    for (const msg of conversation.messages) {
      const role = msg.role === 'user' ? '**You**' : '**Claude**';
      lines.push(`### ${role}`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Convert conversation to full markdown format (with frontmatter, for file export).
   */
  function toMarkdown(): string {
    const conversation = callbacks.getConversation();
    const lines: string[] = [];
    const date = new Date(conversation.createdAt);
    const dateStr = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // Frontmatter
    lines.push('---');
    lines.push(`title: "${conversation.title}"`);
    lines.push(`date: ${date.toISOString()}`);
    lines.push('tags:');
    lines.push('  - claude-chat');
    lines.push('---');
    lines.push('');

    // Header
    lines.push(`# ${conversation.title}`);
    lines.push('');
    lines.push(`*Exported from Claude Chat on ${dateStr}*`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Messages
    for (const msg of conversation.messages) {
      const role = msg.role === 'user' ? '**You**' : '**Claude**';
      const time = new Date(msg.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });

      lines.push(`### ${role} *${time}*`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');

      // Include tool calls if present
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        lines.push('<details>');
        lines.push('<summary>Tool calls</summary>');
        lines.push('');
        for (const tool of msg.toolCalls) {
          lines.push(`- **${tool.name}**`);
          if (tool.result) {
            lines.push('  ```');
            lines.push(`  ${tool.result.slice(0, 200)}${tool.result.length > 200 ? '...' : ''}`);
            lines.push('  ```');
          }
        }
        lines.push('');
        lines.push('</details>');
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Convert conversation to JSON string.
   */
  function toJSON(): string {
    const conversation = callbacks.getConversation();
    const exportData: ExportedConversation = {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      exportedAt: Date.now(),
      model: callbacks.getModel(),
      messages: conversation.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        toolCalls: m.toolCalls,
      })),
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Copy conversation to clipboard as markdown.
   */
  async function copyToClipboard(): Promise<void> {
    const conversation = callbacks.getConversation();
    if (conversation.messages.length === 0) {
      callbacks.showStatus('No messages to export', 'info', 2000);
      return;
    }

    const content = toMarkdownSimple();
    await navigator.clipboard.writeText(content);
    callbacks.showStatus('Copied to clipboard', 'success', 2000);
  }

  /**
   * Sanitize a title for use as a filename.
   */
  function sanitizeFilename(title: string): string {
    return title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 50);
  }

  /**
   * Ensure the export folder exists.
   */
  async function ensureExportFolder(): Promise<void> {
    const folderPath = 'Claude Exports';
    const folder = app.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      await app.vault.createFolder(folderPath);
    }
  }

  /**
   * Write content to a file, creating or overwriting as needed.
   */
  async function writeExportFile(filePath: string, content: string): Promise<void> {
    const existingFile = app.vault.getAbstractFileByPath(filePath);
    if (existingFile) {
      await app.vault.modify(existingFile as TFile, content);
    } else {
      await app.vault.create(filePath, content);
    }
  }

  /**
   * Export conversation to markdown file in vault.
   */
  async function downloadMarkdown(): Promise<void> {
    const conversation = callbacks.getConversation();
    if (conversation.messages.length === 0) {
      callbacks.showStatus('No messages to export', 'info', 2000);
      return;
    }

    log.info('Exporting conversation to markdown', { id: conversation.id });

    const content = toMarkdown();
    const sanitizedTitle = sanitizeFilename(conversation.title);
    const filename = `Claude Chat - ${sanitizedTitle}.md`;
    const filePath = `Claude Exports/${filename}`;

    try {
      await ensureExportFolder();
      await writeExportFile(filePath, content);
      callbacks.showStatus(`Exported to "${filename}"`, 'success');
      log.info('Conversation exported', { path: filePath });
    } catch (error) {
      log.error('Failed to export conversation', error);
      callbacks.setStatus('Export failed', 'error');
    }
  }

  /**
   * Export conversation to JSON file in vault.
   */
  async function downloadJSON(): Promise<void> {
    const conversation = callbacks.getConversation();
    if (conversation.messages.length === 0) {
      callbacks.showStatus('No messages to export', 'info', 2000);
      return;
    }

    log.info('Exporting conversation to JSON', { id: conversation.id });

    const content = toJSON();
    const sanitizedTitle = sanitizeFilename(conversation.title);
    const filename = `Claude Chat - ${sanitizedTitle}.json`;
    const filePath = `Claude Exports/${filename}`;

    try {
      await ensureExportFolder();
      await writeExportFile(filePath, content);
      callbacks.showStatus(`Exported JSON to "${filename}"`, 'success');
      log.info('Conversation exported as JSON', { path: filePath });
    } catch (error) {
      log.error('Failed to export JSON', error);
      callbacks.setStatus('Export failed', 'error');
    }
  }

  /**
   * Handle /export command with format argument.
   */
  async function handleExportCommand(args: string): Promise<void> {
    const conversation = callbacks.getConversation();
    if (conversation.messages.length === 0) {
      callbacks.showStatus('No messages to export', 'info', 2000);
      return;
    }

    const format = args.toLowerCase().trim();

    switch (format) {
      case 'clipboard':
      case 'copy':
        await copyToClipboard();
        break;
      case 'json':
        await downloadJSON();
        break;
      case 'md':
      case 'markdown':
      case '':
        await downloadMarkdown();
        break;
      default:
        callbacks.showStatus('Unknown format. Use: /export [clipboard|json|markdown]', 'info', 3000);
    }
  }

  function destroy(): void {
    // No cleanup needed for this module
  }

  return {
    toMarkdown,
    toJSON,
    copyToClipboard,
    downloadMarkdown,
    downloadJSON,
    handleExportCommand,
    destroy,
  };
}
