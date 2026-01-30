/**
 * Slash command handlers for ChatView.
 *
 * Commands are extracted here to reduce chatView.ts size while maintaining
 * access to necessary state through the ChatViewCommandContext interface.
 */

import { Notice } from 'obsidian';
import type ObsidiClaudePlugin from '../main';
import type { Conversation, SavedPrompt } from './types';
import { generateId } from './types';
import { createLogger } from './logger';

const log = createLogger('ChatViewCommands');

/**
 * Context passed to command handlers for accessing ChatView state and methods.
 */
export interface ChatViewCommandContext {
  plugin: ObsidiClaudePlugin;
  conversation: Conversation;

  // UI elements
  inputEl: HTMLTextAreaElement;
  searchInput: HTMLInputElement;
  messagesContainer: HTMLElement;

  // State accessors
  getMessageQueue(): Array<{ content: string; timestamp: number }>;
  isSearchVisible(): boolean;

  // UI methods
  showTemporaryStatus(message: string, type: 'info' | 'error' | 'success', durationMs?: number): void;
  setStatus(message: string, type?: 'info' | 'error' | 'success'): void;
  renderAllMessages(): void;
  scrollToBottom(force?: boolean): void;

  // Actions
  clearMessages(): Promise<void>;
  newConversation(): Promise<void>;
  toggleSearch(): void;
  clearQueue(): void;
  performSearch(query: string): void;
  addTagToConversation(tag: string): Promise<void>;
  removeTagFromConversation(tag: string): Promise<void>;
  saveConversation(): Promise<void>;
  exportConversation(): Promise<void>;
  exportToClipboard(): Promise<void>;
  exportToJson(): Promise<void>;

  // Input helpers
  resizeInput(): void;
  focusInput(): void;
}

/**
 * Result of a command execution.
 */
export interface CommandResult {
  /** Whether the command was handled */
  handled: boolean;
  /** Optional message to display */
  message?: string;
  /** Message type */
  messageType?: 'info' | 'error' | 'success';
}

/**
 * Command handler function signature.
 */
export type CommandHandler = (
  args: string,
  ctx: ChatViewCommandContext
) => Promise<CommandResult>;

/**
 * Registry of slash commands.
 */
const commands: Map<string, CommandHandler> = new Map();

/**
 * Register a command handler.
 */
export function registerCommand(name: string, handler: CommandHandler): void {
  commands.set(name.toLowerCase(), handler);
}

/**
 * Execute a slash command.
 */
export async function executeCommand(
  input: string,
  ctx: ChatViewCommandContext
): Promise<boolean> {
  const parts = input.slice(1).split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  log.debug('Processing slash command', { command, args });

  const handler = commands.get(command);
  if (handler) {
    try {
      const result = await handler(args, ctx);
      if (result.message) {
        ctx.showTemporaryStatus(result.message, result.messageType || 'info', 3000);
      }
      return result.handled;
    } catch (error) {
      log.error('Command failed', { command, error });
      ctx.setStatus(`Command failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
      return true;
    }
  }

  // Unknown command
  return false;
}

/**
 * Get list of available commands for help display.
 */
export function getCommandList(): Array<{ name: string; description: string }> {
  return [
    { name: '/clear', description: 'Clear current conversation messages' },
    { name: '/new', description: 'Start a new conversation' },
    { name: '/export [clipboard|json]', description: 'Export conversation' },
    { name: '/note [question]', description: 'Insert active note as context' },
    { name: '/search <query>', description: 'Search messages' },
    { name: '/queue [clear]', description: 'Show/clear message queue' },
    { name: '/tag [add|remove|list] <tag>', description: 'Manage conversation tags' },
    { name: '/history', description: 'Toggle conversation history panel' },
    { name: '/help', description: 'Show available commands' },
    { name: '/model <name>', description: 'Switch model mid-conversation' },
    { name: '/budget [amount|show|reset]', description: 'Manage conversation budget' },
    { name: '/undo [preview]', description: 'Rewind to previous message' },
    { name: '/mcp [status|reconnect|add|remove]', description: 'Manage MCP servers' },
    { name: '/mode <mode>', description: 'Change permission mode' },
    { name: '/prompts [use|save|delete|list]', description: 'Manage prompt templates' },
    { name: '/skills', description: 'List available skills' },
    { name: '/extract <schema>', description: 'Extract structured data from note' },
    { name: '/analyze', description: 'Analyze active note structure' },
    { name: '/generate <filename>', description: 'Generate note from conversation' },
  ];
}

// ===== REGISTER BUILT-IN COMMANDS =====

registerCommand('clear', async (_args, ctx) => {
  await ctx.clearMessages();
  return { handled: true };
});

registerCommand('new', async (_args, ctx) => {
  await ctx.newConversation();
  return { handled: true };
});

registerCommand('export', async (args, ctx) => {
  if (args === 'clipboard') {
    await ctx.exportToClipboard();
  } else if (args === 'json') {
    await ctx.exportToJson();
  } else {
    await ctx.exportConversation();
  }
  return { handled: true };
});

registerCommand('search', async (args, ctx) => {
  if (args) {
    ctx.searchInput.value = args;
    ctx.performSearch(args);
  }
  if (!ctx.isSearchVisible()) {
    ctx.toggleSearch();
  }
  return { handled: true };
});

registerCommand('queue', async (args, ctx) => {
  if (args === 'clear') {
    ctx.clearQueue();
    return { handled: true, message: 'Queue cleared', messageType: 'success' };
  }
  const count = ctx.getMessageQueue().length;
  return {
    handled: true,
    message: count === 0
      ? 'Message queue is empty'
      : `${count} message${count !== 1 ? 's' : ''} in queue`,
    messageType: 'info',
  };
});

registerCommand('help', async (_args, ctx) => {
  // Build help message
  const commandList = getCommandList();
  const helpLines = ['**Available Commands:**', ''];
  for (const cmd of commandList) {
    helpLines.push(`\`${cmd.name}\` - ${cmd.description}`);
  }

  // Show in a notice since we can't easily add a system message
  new Notice(commandList.map(c => `${c.name}: ${c.description}`).join('\n'), 10000);
  return { handled: true };
});

registerCommand('history', async (_args, ctx) => {
  // This needs to be handled by ChatView directly since it toggles UI
  return { handled: false };
});

registerCommand('note', async (args, ctx) => {
  const activeFile = ctx.plugin.app.workspace.getActiveFile();
  if (!activeFile) {
    return { handled: true, message: 'No active note', messageType: 'info' };
  }

  try {
    const noteContent = await ctx.plugin.app.vault.read(activeFile);
    const contextMessage = `[Context from "${activeFile.basename}"]\n\n${noteContent}`;

    if (args) {
      ctx.inputEl.value = `${contextMessage}\n\n---\n\n${args}`;
    } else {
      ctx.inputEl.value = contextMessage;
    }

    ctx.resizeInput();
    ctx.focusInput();
    return {
      handled: true,
      message: `Added "${activeFile.basename}" to input`,
      messageType: 'success'
    };
  } catch (error) {
    log.error('Failed to read active note', error);
    return { handled: true, message: 'Failed to read note', messageType: 'error' };
  }
});

registerCommand('tag', async (args, ctx) => {
  return handleTagCommand(args, ctx);
});

registerCommand('tags', async (args, ctx) => {
  return handleTagCommand(args, ctx);
});

async function handleTagCommand(args: string, ctx: ChatViewCommandContext): Promise<CommandResult> {
  if (!args) {
    const tags = ctx.conversation.tags || [];
    if (tags.length === 0) {
      return {
        handled: true,
        message: 'No tags on this conversation. Use /tag add <tag> to add one.',
        messageType: 'info'
      };
    }
    return { handled: true, message: `Tags: ${tags.join(', ')}`, messageType: 'info' };
  }

  if (args.startsWith('add ')) {
    const newTag = args.slice(4).trim();
    if (newTag) {
      await ctx.addTagToConversation(newTag);
      return { handled: true, message: `Added tag: ${newTag}`, messageType: 'success' };
    }
  } else if (args.startsWith('remove ') || args.startsWith('rm ')) {
    const tagToRemove = args.replace(/^(remove|rm)\s+/, '').trim();
    if (tagToRemove) {
      await ctx.removeTagFromConversation(tagToRemove);
      return { handled: true, message: `Removed tag: ${tagToRemove}`, messageType: 'success' };
    }
  } else if (args === 'list') {
    const allTags = await ctx.plugin.storage.getAllTags();
    if (allTags.length === 0) {
      return { handled: true, message: 'No tags found across conversations', messageType: 'info' };
    }
    return { handled: true, message: `All tags: ${allTags.join(', ')}`, messageType: 'info' };
  }

  return { handled: true, message: 'Usage: /tag [add|remove|list] <tag>', messageType: 'info' };
}

// Model command - needs backend access
registerCommand('model', async (args, ctx) => {
  if (!args) {
    return {
      handled: true,
      message: `Current model: ${ctx.plugin.settings.model}`,
      messageType: 'info'
    };
  }

  // Validate model name
  const validModels = ['claude-sonnet-4-5', 'claude-opus-4', 'claude-3-5-sonnet-20241022', 'sonnet', 'opus', 'haiku'];
  const normalizedModel = args.toLowerCase();

  if (!validModels.some(m => m.includes(normalizedModel))) {
    return {
      handled: true,
      message: `Unknown model. Available: ${validModels.join(', ')}`,
      messageType: 'error'
    };
  }

  // Try to switch model via backend
  const backend = ctx.plugin.backendFactory?.getBackend();
  if (backend && 'setModel' in backend) {
    try {
      await (backend as { setModel: (m: string) => Promise<void> }).setModel(args);
      return { handled: true, message: `Switched to model: ${args}`, messageType: 'success' };
    } catch (error) {
      return { handled: true, message: `Failed to switch model: ${error}`, messageType: 'error' };
    }
  }

  return { handled: true, message: 'Model switching not available with current backend', messageType: 'info' };
});

registerCommand('skills', async (_args, ctx) => {
  const skills = ctx.plugin.skillService?.getSkills() || [];
  if (skills.length === 0) {
    return { handled: true, message: 'No skills loaded', messageType: 'info' };
  }

  const skillList = skills.map(s => `• ${s.name}: ${s.description}`).join('\n');
  new Notice(`Available Skills:\n${skillList}`, 10000);
  return { handled: true };
});
