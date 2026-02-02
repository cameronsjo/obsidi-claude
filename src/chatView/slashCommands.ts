/**
 * Slash command processing module for ChatView.
 * Handles command parsing, help display, and skills listing.
 */
import type { ModuleDeps, ModuleHandle, ChatMessage } from './types';
import { executeCommand, getCommandList, type ChatViewCommandContext } from '../chatViewCommands';
import { generateId } from '../types';
import { createLogger } from '../logger';

const log = createLogger('SlashCommands');

/**
 * Information about a command for display purposes.
 */
export interface CommandInfo {
  name: string;
  description: string;
}

/**
 * Skill information for display.
 */
export interface SkillInfo {
  name: string;
  description: string;
  triggers: string[];
  alwaysActive: boolean;
}

/**
 * Callbacks for slash commands to communicate with parent.
 */
export interface SlashCommandsCallbacks {
  /** Get the command context for executeCommand */
  getCommandContext: () => ChatViewCommandContext;
  /** Render a message in the chat */
  renderMessage: (msg: ChatMessage) => void;
  /** Scroll to bottom of messages */
  scrollToBottom: (force?: boolean) => void;
  /** Show temporary status message */
  showTemporaryStatus: (msg: string, type: 'info' | 'error' | 'success', duration?: number) => void;
  /** Toggle history panel */
  toggleHistory: () => Promise<void>;
  /** Toggle pin on conversation */
  togglePin: () => Promise<void>;
  /** Rename conversation */
  renameConversation: (title?: string) => void;
  /** Show stats for conversation */
  showStats: () => void;
  /** Show usage dashboard */
  showUsageDashboard: () => Promise<void>;
  /** Copy conversation to clipboard */
  copyToClipboard: () => Promise<void>;
  /** Handle tools command */
  handleToolsCommand: (args: string) => Promise<void>;
  /** Handle context command */
  handleContextCommand: (args: string) => Promise<void>;
  /** Handle duplicate/fork command */
  handleDuplicateCommand: () => Promise<void>;
  /** Show bookmarks */
  showBookmarks: () => void;
  /** Handle prompts command */
  handlePromptsCommand: (args: string) => Promise<void>;
  /** Handle undo command */
  handleUndoCommand: (args: string) => Promise<void>;
  /** Handle budget command */
  handleBudgetCommand: (args: string) => Promise<void>;
  /** Show cost summary */
  showCostSummary: () => void;
  /** Generate note from conversation */
  generateNote: (args: string) => Promise<void>;
  /** Handle permission mode command */
  handleModeCommand: (args: string) => Promise<void>;
  /** Handle MCP command */
  handleMcpCommand: (args: string) => Promise<void>;
  /** Handle extract command */
  handleExtractCommand: (args: string) => Promise<void>;
  /** Handle analyze command */
  handleAnalyzeCommand: (args: string) => Promise<void>;
  /** Get available skills */
  getSkills: () => SkillInfo[];
  /** Check if skills are enabled */
  skillsEnabled: () => boolean;
  /** Get skills folder path */
  getSkillsFolderPath: () => string;
}

/**
 * Handle for controlling slash command processing.
 */
export interface SlashCommandsHandle extends ModuleHandle {
  /**
   * Process a slash command input.
   * Returns true if the command was handled, false if it should be sent as a message.
   */
  process(input: string): Promise<boolean>;

  /**
   * Get list of available commands.
   */
  getCommands(): CommandInfo[];

  /**
   * Show help message in the chat.
   */
  showHelp(): void;

  /**
   * Show skills list in the chat.
   */
  showSkillsList(): void;
}

/**
 * Create a slash commands processor.
 * @param deps - Module dependencies
 * @param callbacks - Callbacks for parent communication
 */
export function createSlashCommands(
  deps: ModuleDeps,
  callbacks: SlashCommandsCallbacks
): SlashCommandsHandle {

  /**
   * Process a slash command.
   */
  async function process(input: string): Promise<boolean> {
    // Try the modular command system first
    const ctx = callbacks.getCommandContext();
    const handled = await executeCommand(input, ctx);
    if (handled) {
      return true;
    }

    // Fall back to inline handlers for complex commands not yet extracted
    const parts = input.slice(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    log.debug('Processing slash command (fallback)', { command, args });

    switch (command) {
      // Commands handled by modular system: clear, new, export, note, search,
      // queue, help, tag, tags, model, skills

      case 'history':
        await callbacks.toggleHistory();
        return true;

      case 'pin':
        await callbacks.togglePin();
        return true;

      case 'rename':
        callbacks.renameConversation(args || undefined);
        return true;

      case 'stats':
        callbacks.showStats();
        return true;

      case 'usage':
        await callbacks.showUsageDashboard();
        return true;

      case 'copy':
        await callbacks.copyToClipboard();
        return true;

      case 'tools':
        await callbacks.handleToolsCommand(args);
        return true;

      case 'context':
        await callbacks.handleContextCommand(args);
        return true;

      case 'duplicate':
      case 'fork':
        await callbacks.handleDuplicateCommand();
        return true;

      case 'bookmarks':
        callbacks.showBookmarks();
        return true;

      case 'help':
      case '?':
        showHelp();
        return true;

      case 'prompts':
      case 'prompt':
        await callbacks.handlePromptsCommand(args);
        return true;

      case 'undo':
        await callbacks.handleUndoCommand(args);
        return true;

      case 'budget':
        await callbacks.handleBudgetCommand(args);
        return true;

      case 'cost':
        callbacks.showCostSummary();
        return true;

      case 'savenote':
      case 'save-note':
      case 'generate-note':
        await callbacks.generateNote(args);
        return true;

      case 'skills':
        showSkillsList();
        return true;

      case 'mode':
      case 'permission':
        await callbacks.handleModeCommand(args);
        return true;

      case 'mcp':
        await callbacks.handleMcpCommand(args);
        return true;

      case 'extract':
      case 'extract-tasks':
        await callbacks.handleExtractCommand(args);
        return true;

      case 'analyze':
      case 'analyze-note':
        await callbacks.handleAnalyzeCommand(args);
        return true;

      default:
        // Unknown command - show help hint
        callbacks.showTemporaryStatus(`Unknown command: /${command}. Type /help for available commands.`, 'info');
        return true;
    }
  }

  /**
   * Get list of available commands.
   */
  function getCommands(): CommandInfo[] {
    return getCommandList();
  }

  /**
   * Show help message in the chat.
   */
  function showHelp(): void {
    const helpText = `
**Conversation:**
- \`/new\` - Start new conversation
- \`/clear\` - Clear all messages
- \`/copy\` - Copy conversation to clipboard
- \`/export\` - Export as markdown note
- \`/export clipboard\` - Copy conversation to clipboard
- \`/export json\` - Export as JSON file
- \`/duplicate\` - Fork conversation (create editable copy)
- \`/undo\` - Rewind file changes to last checkpoint (SDK only)
- \`/undo --dry-run\` - Preview what /undo would restore
- \`/budget\` - Show current spend and limit
- \`/budget set <amount>\` - Set spending limit (e.g., /budget set 5.00)
- \`/budget clear\` - Remove spending limit
- \`/cost\` - Quick cost summary for this conversation
- \`/stats\` - Show conversation statistics
- \`/usage\` - Show usage dashboard (costs across conversations)
- \`/rename [title]\` - Rename conversation
- \`/pin\` - Toggle pin status

**Tags:**
- \`/tag\` - Show current tags
- \`/tag <name>\` - Add a tag
- \`/tag remove <name>\` - Remove a tag
- \`/tag list\` - All tags across conversations

**Settings:**
- \`/model [name]\` - Show/switch model (sonnet, opus)
- \`/tools [show|hide]\` - Toggle tool call visibility
- \`/context [on|off]\` - Toggle active note context

**Context:**
- \`/note [question]\` - Insert current note
- \`/search <query>\` - Search messages
- \`/queue [clear]\` - Message queue status
- \`/bookmarks\` - Show bookmarked messages

**Export:**
- \`/savenote [format] [path]\` - Save conversation as note
  - Formats: full (default), summary, q-and-a
  - Example: \`/savenote q-and-a research/meeting.md\`

**Skills:**
- \`/skills\` - List available skills and their triggers

**Prompts:**
- \`/prompts\` - List saved prompt templates
- \`/prompts use <name>\` - Insert a saved prompt
- \`/prompts save <name>\` - Save current input as prompt
- \`/prompts delete <name>\` - Delete a saved prompt

**Permissions (SDK only):**
- \`/mode\` - Show current permission mode
- \`/mode <mode>\` - Switch mode (default, acceptEdits, plan, etc.)

**MCP Servers (SDK only):**
- \`/mcp\` - Show MCP server status
- \`/mcp reconnect <name>\` - Reconnect failed server
- \`/mcp toggle <name>\` - Enable/disable server
- \`/mcp add <name> <cmd> [args]\` - Add server dynamically
- \`/mcp remove <name>\` - Remove/disable server

**Structured Analysis (SDK only):**
- \`/extract\` - Extract tasks, links, tags, and summary from current note
- \`/analyze\` - Analyze note for topics, sentiment, readability, and improvements

**Shortcuts:**
\`Enter\` send · \`Shift+Enter\` newline · \`↑↓\` history
\`Cmd+F\` search · \`Cmd+N\` new · \`Cmd+H\` history · \`Cmd+E\` export
\`Cmd+L\` focus input · \`Cmd+Shift+P\` pin · \`Esc\` close/focus
    `.trim();

    // Create a temporary system message to show help
    const helpMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: helpText,
      timestamp: Date.now(),
    };

    callbacks.renderMessage(helpMsg);
    callbacks.scrollToBottom(true);
  }

  /**
   * Show the list of available skills.
   */
  function showSkillsList(): void {
    const skills = callbacks.getSkills();

    if (!callbacks.skillsEnabled()) {
      callbacks.showTemporaryStatus('Skills are disabled. Enable them in settings.', 'info', 3000);
      return;
    }

    if (skills.length === 0) {
      callbacks.showTemporaryStatus(
        `No skills found. Add SKILL.md files to ${callbacks.getSkillsFolderPath()}`,
        'info',
        3000
      );
      return;
    }

    // Build skills display
    const lines: string[] = ['**Available Skills:**\n'];

    // Group skills by always-active vs triggered
    const alwaysActive = skills.filter(s => s.alwaysActive);
    const triggered = skills.filter(s => !s.alwaysActive);

    if (alwaysActive.length > 0) {
      lines.push('**Always Active:**');
      for (const skill of alwaysActive) {
        lines.push(`- **${skill.name}**: ${skill.description}`);
      }
      lines.push('');
    }

    if (triggered.length > 0) {
      lines.push('**Triggered by Keywords:**');
      for (const skill of triggered) {
        const triggers = skill.triggers.slice(0, 3).join(', ');
        const moreCount = skill.triggers.length > 3 ? ` +${skill.triggers.length - 3} more` : '';
        lines.push(`- **${skill.name}**: ${skill.description}`);
        if (triggers) {
          lines.push(`  - *Triggers:* ${triggers}${moreCount}`);
        }
      }
    }

    lines.push('');
    lines.push(`*Skills folder: \`${callbacks.getSkillsFolderPath()}\`*`);

    const skillsMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: lines.join('\n'),
      timestamp: Date.now(),
    };

    callbacks.renderMessage(skillsMsg);
    callbacks.scrollToBottom(true);
  }

  function destroy(): void {
    // No DOM elements to clean up
  }

  return {
    process,
    getCommands,
    showHelp,
    showSkillsList,
    destroy,
  };
}
