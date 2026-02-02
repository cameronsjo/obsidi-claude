/**
 * Slash command handlers module for ChatView.
 * Contains implementations for all slash commands.
 */
import { Notice, MarkdownView } from 'obsidian';
import type { ModuleDeps, ChatMessage, ToolCallInfo } from './types';
import type { Conversation, SavedPrompt } from '../types';
import { generateId, calculateConversationUsage, calculateCost } from '../types';
import type { AgentCallbacks, AgentBackend } from '../backends';
import { createLogger } from '../logger';

const log = createLogger('SlashCommandHandlers');

/**
 * Dependencies needed by command handlers.
 */
export interface CommandHandlerDeps extends ModuleDeps {
  getConversation: () => Conversation;
  saveConversation: () => Promise<void>;
  renderMessage: (msg: ChatMessage) => void;
  scrollToBottom: (force?: boolean) => void;
  showTemporaryStatus: (msg: string, type: 'info' | 'error' | 'success', duration?: number) => void;
  setStatus: (msg: string, type?: 'info' | 'error' | 'success') => void;
  setProcessing: (processing: boolean) => void;
  updateMessageContent: (messageId: string, content: string) => void;
  updateMessageTools: (messageId: string, tools: ToolCallInfo[]) => void;
  getBackend: () => AgentBackend;
  historyRefresh: () => Promise<void>;
  estimateTokens: () => number;
  inputValue: () => string;
}

/**
 * Handle /tools command.
 */
export async function handleToolsCommand(
  args: string,
  deps: CommandHandlerDeps
): Promise<void> {
  if (!args) {
    const tools = deps.plugin.settings.allowedTools;
    deps.showTemporaryStatus(`Allowed tools: ${tools.join(', ')}`, 'info', 3000);
  } else if (args === 'show' || args === 'on') {
    deps.plugin.settings.showToolCalls = true;
    await deps.plugin.saveSettings();
    deps.showTemporaryStatus('Tool calls visible', 'success', 1500);
  } else if (args === 'hide' || args === 'off') {
    deps.plugin.settings.showToolCalls = false;
    await deps.plugin.saveSettings();
    deps.showTemporaryStatus('Tool calls hidden', 'success', 1500);
  }
}

/**
 * Handle /context command.
 */
export async function handleContextCommand(
  args: string,
  deps: CommandHandlerDeps,
  updateContextBadge: () => void
): Promise<void> {
  if (args === 'on') {
    deps.plugin.settings.activeNoteContext = true;
    await deps.plugin.saveSettings();
    updateContextBadge();
    deps.showTemporaryStatus('Active note context enabled', 'success', 1500);
  } else if (args === 'off') {
    deps.plugin.settings.activeNoteContext = false;
    await deps.plugin.saveSettings();
    updateContextBadge();
    deps.showTemporaryStatus('Active note context disabled', 'success', 1500);
  } else {
    const status = deps.plugin.settings.activeNoteContext ? 'enabled' : 'disabled';
    deps.showTemporaryStatus(`Active note context: ${status}`, 'info', 2000);
  }
}

/**
 * Handle /duplicate or /fork command.
 */
export async function handleDuplicateCommand(
  deps: CommandHandlerDeps,
  onConversationChange: (conv: Conversation) => Promise<void>
): Promise<void> {
  const conversation = deps.getConversation();
  const newConv = await deps.plugin.storage.duplicateConversation(conversation.id);
  if (newConv) {
    const sessionId = conversation.metadata?.sessionId;
    if (sessionId && deps.getBackend().type === 'sdk') {
      if (!newConv.metadata) {
        newConv.metadata = { backendType: 'sdk' };
      }
      newConv.metadata.forkFromSessionId = sessionId;
      await deps.plugin.storage.saveConversation(newConv);
      deps.showTemporaryStatus('Conversation forked - SDK session will branch on next message', 'success', 3000);
    } else {
      deps.showTemporaryStatus('Conversation duplicated - now editing copy', 'success', 2000);
    }
    await onConversationChange(newConv);
  }
}

/**
 * Show bookmarked messages.
 */
export function showBookmarks(deps: CommandHandlerDeps): void {
  const conversation = deps.getConversation();
  const bookmarked = conversation.messages.filter(m => m.bookmarked);
  if (bookmarked.length === 0) {
    deps.showTemporaryStatus('No bookmarked messages. Click star on a message to bookmark it.', 'info', 3000);
  } else {
    const summaryLines = bookmarked.map((m, i) => {
      const preview = m.content.slice(0, 60).replace(/\n/g, ' ');
      const role = m.role === 'user' ? 'You' : 'Claude';
      return `${i + 1}. **${role}**: ${preview}${m.content.length > 60 ? '...' : ''}`;
    });

    const bookmarkMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: `**Bookmarked Messages (${bookmarked.length}):**\n\n${summaryLines.join('\n')}`,
      timestamp: Date.now(),
    };
    deps.renderMessage(bookmarkMsg);
    deps.scrollToBottom(true);
  }
}

/**
 * Show quick cost summary for current conversation.
 */
export function showCostSummary(deps: CommandHandlerDeps): void {
  const conversation = deps.getConversation();
  const usage = conversation.usage;
  if (!usage || usage.totalCost === 0) {
    deps.showTemporaryStatus('No usage data yet for this conversation', 'info', 2000);
  } else {
    const inputK = Math.round(usage.totalInputTokens / 1000);
    const outputK = Math.round(usage.totalOutputTokens / 1000);
    deps.showTemporaryStatus(
      `Cost: $${usage.totalCost.toFixed(4)} (${inputK}K in / ${outputK}K out)`,
      'info',
      4000
    );
  }
}

/**
 * Show conversation statistics.
 */
export function showConversationStats(deps: CommandHandlerDeps): void {
  const conversation = deps.getConversation();
  const msgCount = conversation.messages.length;
  const userMsgs = conversation.messages.filter(m => m.role === 'user').length;
  const assistantMsgs = conversation.messages.filter(m => m.role === 'assistant').length;
  const tokens = deps.estimateTokens();
  const upVotes = conversation.messages.filter(m => m.reaction === 'up').length;
  const downVotes = conversation.messages.filter(m => m.reaction === 'down').length;
  const created = new Date(conversation.createdAt).toLocaleDateString();

  const usage = conversation.usage ?? calculateConversationUsage(conversation.messages);
  const usageLines = usage.totalCost > 0 ? `
- Input tokens: ${usage.totalInputTokens.toLocaleString()}
- Output tokens: ${usage.totalOutputTokens.toLocaleString()}
- Total cost: $${usage.totalCost.toFixed(4)}` : '';

  const statsText = `
**Conversation Stats:**
- Messages: ${msgCount} (${userMsgs} user, ${assistantMsgs} assistant)
- Est. tokens: ~${tokens.toLocaleString()}${usageLines}
- Created: ${created}
- Pinned: ${conversation.pinned ? 'Yes' : 'No'}
- Tags: ${(conversation.tags || []).join(', ') || 'None'}
- Reactions: ${upVotes} thumbsUp / ${downVotes} thumbsDown
  `.trim();

  const statsMsg: ChatMessage = {
    id: generateId(),
    role: 'assistant',
    content: statsText,
    timestamp: Date.now(),
  };
  deps.renderMessage(statsMsg);
  deps.scrollToBottom(true);
}

/**
 * Show usage dashboard with aggregated stats across all conversations.
 */
export async function showUsageDashboard(deps: CommandHandlerDeps): Promise<void> {
  const conversations = await deps.plugin.storage.listConversations();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  let conversationsWithUsage = 0;

  const conversationStats: Array<{
    title: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }> = [];

  for (const meta of conversations.slice(0, 20)) {
    const conv = await deps.plugin.storage.loadConversation(meta.id);
    if (conv) {
      const usage = conv.usage ?? calculateConversationUsage(conv.messages);
      if (usage.totalCost > 0) {
        conversationsWithUsage++;
        totalInputTokens += usage.totalInputTokens;
        totalOutputTokens += usage.totalOutputTokens;
        totalCost += usage.totalCost;
        conversationStats.push({
          title: conv.title.slice(0, 30),
          inputTokens: usage.totalInputTokens,
          outputTokens: usage.totalOutputTokens,
          cost: usage.totalCost,
        });
      }
    }
  }

  const lines: string[] = ['# Usage Dashboard'];
  lines.push('');
  lines.push('## Summary');
  lines.push(`- Total input tokens: ${totalInputTokens.toLocaleString()}`);
  lines.push(`- Total output tokens: ${totalOutputTokens.toLocaleString()}`);
  lines.push(`- **Total cost: $${totalCost.toFixed(4)}**`);
  lines.push(`- Conversations tracked: ${conversationsWithUsage}`);
  lines.push('');

  if (conversationStats.length > 0) {
    lines.push('## Top Conversations by Cost');
    lines.push('');
    const sorted = conversationStats.sort((a, b) => b.cost - a.cost).slice(0, 5);
    for (const stat of sorted) {
      lines.push(`- **${stat.title}**: $${stat.cost.toFixed(4)} (${stat.inputTokens.toLocaleString()} in / ${stat.outputTokens.toLocaleString()} out)`);
    }
  } else {
    lines.push('*No usage data tracked yet. Usage data is captured from API responses.*');
  }

  const dashboardMsg: ChatMessage = {
    id: generateId(),
    role: 'assistant',
    content: lines.join('\n'),
    timestamp: Date.now(),
  };
  deps.renderMessage(dashboardMsg);
  deps.scrollToBottom(true);
}

/**
 * Handle /undo command to rewind file changes.
 */
export async function handleUndoCommand(
  args: string,
  deps: CommandHandlerDeps
): Promise<void> {
  const backend = deps.getBackend();

  if (backend.type !== 'sdk') {
    deps.showTemporaryStatus('Undo requires SDK backend (not available on mobile)', 'info', 3000);
    return;
  }

  if (!deps.plugin.settings.enableFileCheckpointing) {
    deps.showTemporaryStatus('File checkpointing is disabled. Enable it in settings to use /undo', 'info', 3000);
    return;
  }

  const conversation = deps.getConversation();
  const checkpoints = conversation.messages
    .filter(m => m.sdkUuid && m.role === 'assistant')
    .map((m, index) => ({
      uuid: m.sdkUuid!,
      timestamp: m.timestamp,
      preview: m.content.slice(0, 80).replace(/\n/g, ' ') + (m.content.length > 80 ? '...' : ''),
      index,
    }));

  if (checkpoints.length === 0) {
    deps.showTemporaryStatus('No checkpoints available. File changes are tracked after each message.', 'info', 3000);
    return;
  }

  const isDryRun = args.includes('--dry-run') || args.includes('-n');

  if (!args || isDryRun) {
    const sdkBackend = backend as { rewindFiles?: (uuid: string, dryRun: boolean) => Promise<{ canRewind: boolean; filesChanged?: string[]; insertions?: number; deletions?: number; error?: string } | null> };

    if (!sdkBackend.rewindFiles) {
      deps.showTemporaryStatus('Rewind not available', 'error', 3000);
      return;
    }

    const latest = checkpoints[checkpoints.length - 1];
    const result = await sdkBackend.rewindFiles(latest.uuid, true);

    if (!result || !result.canRewind) {
      deps.showTemporaryStatus(result?.error || 'Cannot rewind to this checkpoint', 'error', 3000);
      return;
    }

    const filesChanged = result.filesChanged?.length || 0;
    const insertions = result.insertions || 0;
    const deletions = result.deletions || 0;

    if (filesChanged === 0) {
      deps.showTemporaryStatus('No file changes to undo', 'info', 3000);
      return;
    }

    if (isDryRun) {
      const changesMsg = `Would restore ${filesChanged} file(s): +${insertions}/-${deletions} lines`;
      deps.showTemporaryStatus(changesMsg, 'info', 5000);
      return;
    }

    const actualResult = await sdkBackend.rewindFiles(latest.uuid, false);

    if (actualResult?.canRewind) {
      const changesMsg = `Restored ${filesChanged} file(s): +${insertions}/-${deletions} lines`;
      deps.showTemporaryStatus(changesMsg, 'success', 3000);
      log.info('Files rewound successfully', { uuid: latest.uuid, result: actualResult });
    } else {
      deps.showTemporaryStatus(actualResult?.error || 'Failed to rewind files', 'error', 3000);
    }
  }
}

/**
 * Handle /budget command for spending limits.
 */
export async function handleBudgetCommand(
  args: string,
  deps: CommandHandlerDeps
): Promise<void> {
  const conversation = deps.getConversation();
  const currentUsage = conversation.usage;
  const currentCost = currentUsage?.totalCost ?? 0;
  const currentLimit = deps.plugin.settings.maxBudgetUsd;

  if (!args || args === 'show') {
    const limitStr = currentLimit ? `$${currentLimit.toFixed(2)}` : 'No limit';
    const spentStr = `$${currentCost.toFixed(4)}`;
    const remaining = currentLimit ? Math.max(0, currentLimit - currentCost) : null;
    const remainingStr = remaining !== null ? `$${remaining.toFixed(4)}` : '...';
    const pct = currentLimit ? Math.round((currentCost / currentLimit) * 100) : 0;

    let status = `Budget: ${spentStr} spent`;
    if (currentLimit) {
      status += ` / ${limitStr} (${pct}% used, ${remainingStr} remaining)`;
      if (pct >= 80) {
        status += ' Warning';
      }
    } else {
      status += ' (no limit set)';
    }
    deps.showTemporaryStatus(status, 'info', 5000);

  } else if (args.startsWith('set ')) {
    const valueStr = args.slice(4).trim().replace('$', '');
    const value = parseFloat(valueStr);

    if (isNaN(value) || value <= 0) {
      deps.showTemporaryStatus('Invalid budget. Use: /budget set 5.00', 'error', 3000);
      return;
    }

    deps.plugin.settings.maxBudgetUsd = value;
    await deps.plugin.saveSettings();
    deps.showTemporaryStatus(`Budget limit set to $${value.toFixed(2)}`, 'success', 3000);

  } else if (args === 'clear' || args === 'remove') {
    deps.plugin.settings.maxBudgetUsd = undefined;
    await deps.plugin.saveSettings();
    deps.showTemporaryStatus('Budget limit removed', 'success', 3000);

  } else {
    deps.showTemporaryStatus('Usage: /budget, /budget set <amount>, /budget clear', 'info', 3000);
  }
}

/**
 * Extract variable placeholders from prompt content.
 */
function extractVariables(content: string): string[] {
  const matches = content.match(/\{\{(\w+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.slice(2, -2)))];
}

/**
 * Handle /prompts command for managing saved prompts.
 */
export async function handlePromptsCommand(
  args: string,
  deps: CommandHandlerDeps,
  inputEl: HTMLTextAreaElement,
  resizeInput: () => void
): Promise<void> {
  const parts = args.trim().split(/\s+/);
  const action = parts[0]?.toLowerCase();
  const nameArg = parts.slice(1).join(' ');

  const savedPrompts = deps.plugin.settings.savedPrompts || [];

  // /prompts - list all
  if (!action || action === 'list') {
    if (savedPrompts.length === 0) {
      deps.showTemporaryStatus('No saved prompts. Use /prompts save <name> to create one.', 'info', 3000);
      return;
    }

    const lines: string[] = ['**Saved Prompts:**\n'];
    const byCategory = new Map<string, typeof savedPrompts>();

    for (const prompt of savedPrompts) {
      const cat = prompt.category || 'General';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(prompt);
    }

    for (const [category, prompts] of byCategory) {
      lines.push(`**${category}:**`);
      for (const p of prompts) {
        const preview = p.content.slice(0, 50).replace(/\n/g, ' ') + (p.content.length > 50 ? '...' : '');
        lines.push(`- **${p.name}**: ${preview}`);
      }
      lines.push('');
    }

    lines.push('*Use `/prompts use <name>` to insert a prompt*');

    const msg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: lines.join('\n'),
      timestamp: Date.now(),
    };
    deps.renderMessage(msg);
    deps.scrollToBottom(true);
    return;
  }

  // /prompts use <name>
  if (action === 'use' && nameArg) {
    const prompt = savedPrompts.find(p => p.name.toLowerCase() === nameArg.toLowerCase());
    if (!prompt) {
      deps.showTemporaryStatus(`Prompt "${nameArg}" not found`, 'error', 2000);
      return;
    }

    let content = prompt.content;
    const activeFile = deps.app.workspace.getActiveFile();

    // {{selection}} - Editor selection
    const activeView = deps.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView?.editor) {
      content = content.replace(/\{\{selection\}\}/gi, activeView.editor.getSelection() || '');
    }

    // {{note}} - Current note content
    if (activeFile) {
      const noteContent = await deps.app.vault.cachedRead(activeFile);
      content = content.replace(/\{\{note\}\}/gi, noteContent.slice(0, 8000));
      content = content.replace(/\{\{note_title\}\}/gi, activeFile.basename);
    }

    // {{clipboard}} - Clipboard content
    try {
      const clipboardText = await navigator.clipboard.readText();
      content = content.replace(/\{\{clipboard\}\}/gi, clipboardText);
    } catch {
      content = content.replace(/\{\{clipboard\}\}/gi, '');
    }

    inputEl.value = content;
    inputEl.focus();
    resizeInput();
    deps.showTemporaryStatus(`Loaded prompt: ${prompt.name}`, 'success', 2000);
    return;
  }

  // /prompts save <name> [category]
  if (action === 'save' && nameArg) {
    const currentInput = inputEl.value.trim();
    if (!currentInput) {
      deps.showTemporaryStatus('Nothing to save. Enter text in input first.', 'error', 2000);
      return;
    }

    const [name, category] = nameArg.split('|').map(s => s.trim());
    const existingIdx = savedPrompts.findIndex(p => p.name.toLowerCase() === name.toLowerCase());

    const newPrompt: SavedPrompt = {
      id: generateId(),
      name,
      category: category || 'General',
      content: currentInput,
      variables: extractVariables(currentInput),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (existingIdx >= 0) {
      savedPrompts[existingIdx] = { ...savedPrompts[existingIdx], ...newPrompt, id: savedPrompts[existingIdx].id, createdAt: savedPrompts[existingIdx].createdAt };
    } else {
      savedPrompts.push(newPrompt);
    }

    deps.plugin.settings.savedPrompts = savedPrompts;
    await deps.plugin.saveSettings();
    deps.showTemporaryStatus(`Saved prompt: ${name}`, 'success', 2000);
    return;
  }

  // /prompts delete <name>
  if ((action === 'delete' || action === 'remove') && nameArg) {
    const idx = savedPrompts.findIndex(p => p.name.toLowerCase() === nameArg.toLowerCase());
    if (idx < 0) {
      deps.showTemporaryStatus(`Prompt "${nameArg}" not found`, 'error', 2000);
      return;
    }

    savedPrompts.splice(idx, 1);
    deps.plugin.settings.savedPrompts = savedPrompts;
    await deps.plugin.saveSettings();
    deps.showTemporaryStatus(`Deleted prompt: ${nameArg}`, 'success', 2000);
    return;
  }

  deps.showTemporaryStatus('Usage: /prompts, /prompts use <name>, /prompts save <name>, /prompts delete <name>', 'info', 4000);
}

/**
 * Handle /mcp command to show MCP server status.
 */
export async function handleMcpCommand(
  args: string,
  deps: CommandHandlerDeps
): Promise<void> {
  const backend = deps.getBackend();
  if (backend.type !== 'sdk') {
    deps.showTemporaryStatus('MCP status requires SDK backend', 'info', 3000);
    return;
  }

  const factory = deps.plugin.backendFactory;
  if (!factory) {
    deps.showTemporaryStatus('Backend not initialized', 'error', 3000);
    return;
  }

  const parts = args.trim().split(/\s+/);
  const action = parts[0]?.toLowerCase();
  const serverName = parts[1];

  // /mcp reconnect <name>
  if (action === 'reconnect' && serverName) {
    const success = await factory.reconnectMcpServer(serverName);
    deps.showTemporaryStatus(
      success ? `Reconnected ${serverName}` : `Failed to reconnect ${serverName}`,
      success ? 'success' : 'error',
      2000
    );
    return;
  }

  // /mcp toggle|enable|disable <name>
  if ((action === 'toggle' || action === 'enable' || action === 'disable') && serverName) {
    const enabled = action !== 'disable';
    const success = await factory.toggleMcpServer(serverName, enabled);
    deps.showTemporaryStatus(
      success ? `${serverName} ${enabled ? 'enabled' : 'disabled'}` : `Failed to toggle ${serverName}`,
      success ? 'success' : 'error',
      2000
    );
    return;
  }

  // /mcp add <name> <command> [args...]
  if (action === 'add' && serverName && parts[2]) {
    const command = parts[2];
    const serverArgs = parts.slice(3);

    const currentServers: Record<string, { command: string; args: string[] }> = {};
    currentServers[serverName] = { command, args: serverArgs };

    const result = await factory.setMcpServers(currentServers);
    if (result) {
      if (result.errors[serverName]) {
        deps.showTemporaryStatus(`Failed to add ${serverName}: ${result.errors[serverName]}`, 'error', 3000);
      } else if (result.added.includes(serverName)) {
        deps.showTemporaryStatus(`Added MCP server: ${serverName}`, 'success', 2000);
      } else {
        deps.showTemporaryStatus(`Server ${serverName} already exists`, 'info', 2000);
      }
    } else {
      deps.showTemporaryStatus('No active session - start a conversation first', 'error', 3000);
    }
    return;
  }

  // /mcp remove <name>
  if (action === 'remove' && serverName) {
    const success = await factory.toggleMcpServer(serverName, false);
    deps.showTemporaryStatus(
      success ? `Disabled ${serverName}` : `Failed to disable ${serverName}`,
      success ? 'success' : 'error',
      2000
    );
    return;
  }

  // Default: show status
  const statuses = await factory.getMcpServerStatus();
  if (!statuses || statuses.length === 0) {
    deps.showTemporaryStatus('No MCP servers configured or no active session', 'info', 3000);
    return;
  }

  const statusIcons: Record<string, string> = {
    connected: '[Connected]',
    failed: '[Failed]',
    'needs-auth': '[Needs Auth]',
    pending: '[Pending]',
    disabled: '[Disabled]',
  };

  const lines = ['**MCP Server Status:**\n'];
  for (const server of statuses) {
    const icon = statusIcons[server.status] || '[?]';
    const tools = server.toolCount ? ` (${server.toolCount} tools)` : '';
    const error = server.error ? `\n  - Error: ${server.error}` : '';
    lines.push(`${icon} **${server.name}**: ${server.status}${tools}${error}`);
  }
  lines.push('');
  lines.push('*Commands: `/mcp reconnect|toggle|add|remove <name>`*');

  const mcpMsg: ChatMessage = {
    id: generateId(),
    role: 'assistant',
    content: lines.join('\n'),
    timestamp: Date.now(),
  };
  deps.renderMessage(mcpMsg);
  deps.scrollToBottom(true);
}

/**
 * Handle /mode command to change permission mode.
 */
export async function handlePermissionModeCommand(
  args: string,
  deps: CommandHandlerDeps
): Promise<void> {
  const backend = deps.getBackend();
  if (backend.type !== 'sdk') {
    deps.showTemporaryStatus('Permission mode switching requires SDK backend', 'info', 3000);
    return;
  }

  const validModes = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk'] as const;
  type Mode = typeof validModes[number];

  if (!args) {
    const current = deps.plugin.settings.permissionMode;
    const modeDescriptions = {
      default: 'Prompt for dangerous operations',
      acceptEdits: 'Auto-accept file edits',
      bypassPermissions: 'Skip all checks (dangerous)',
      plan: 'Planning mode, no execution',
      dontAsk: 'Deny if not pre-approved',
    };

    const lines = [
      `**Current mode:** \`${current}\` - ${modeDescriptions[current as Mode] || 'Unknown'}`,
      '',
      '**Available modes:**',
      ...validModes.map((m) => `- \`/mode ${m}\` - ${modeDescriptions[m]}`),
    ];

    const modeMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: lines.join('\n'),
      timestamp: Date.now(),
    };
    deps.renderMessage(modeMsg);
    deps.scrollToBottom(true);
    return;
  }

  const mode = args.toLowerCase() as Mode;
  if (!validModes.includes(mode)) {
    deps.showTemporaryStatus(`Invalid mode: ${args}. Use: ${validModes.join(', ')}`, 'error', 3000);
    return;
  }

  const sdkBackend = backend as { setPermissionMode?: (mode: Mode) => Promise<boolean> };
  if (!sdkBackend.setPermissionMode) {
    deps.showTemporaryStatus('setPermissionMode not available on this backend', 'error', 3000);
    return;
  }

  const success = await sdkBackend.setPermissionMode(mode);
  if (success) {
    deps.plugin.settings.permissionMode = mode;
    await deps.plugin.saveSettings();
    deps.showTemporaryStatus(`Permission mode changed to: ${mode}`, 'success', 2000);
  } else {
    deps.showTemporaryStatus('Failed to change permission mode (no active session)', 'error', 3000);
  }
}

/**
 * Handle /extract command for structured data extraction.
 */
export async function handleExtractCommand(
  deps: CommandHandlerDeps
): Promise<void> {
  const backend = deps.getBackend();
  if (backend.type !== 'sdk') {
    deps.showTemporaryStatus('Structured extraction requires SDK backend', 'info', 3000);
    return;
  }

  const activeFile = deps.app.workspace.getActiveFile();
  if (!activeFile) {
    deps.showTemporaryStatus('No active note to extract from', 'info', 2000);
    return;
  }

  const content = await deps.app.vault.read(activeFile);

  const extractionSchema = {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: 'List of tasks extracted from the note',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The task description' },
            completed: { type: 'boolean', description: 'Whether the task is marked complete' },
            priority: { type: 'string', enum: ['high', 'medium', 'low', 'none'], description: 'Task priority if specified' },
          },
          required: ['text', 'completed'],
        },
      },
      links: {
        type: 'array',
        description: 'Suggested internal links to other notes',
        items: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'The note or concept to link to' },
            reason: { type: 'string', description: 'Why this link would be useful' },
          },
          required: ['target', 'reason'],
        },
      },
      summary: { type: 'string', description: 'A brief 1-2 sentence summary of the note content' },
      tags: { type: 'array', description: 'Suggested tags for the note', items: { type: 'string' } },
    },
    required: ['tasks', 'links', 'summary', 'tags'],
  };

  deps.setProcessing(true);
  deps.setStatus('Extracting structured data...', 'info');

  const conversation = deps.getConversation();

  const callbacks: AgentCallbacks = {
    onMessage: (msg) => {
      conversation.messages.push(msg);
      deps.renderMessage(msg);
      deps.scrollToBottom();
    },
    onStreamingUpdate: (messageId, newContent) => {
      const msg = conversation.messages.find((m) => m.id === messageId);
      if (msg) msg.content = newContent;
      deps.updateMessageContent(messageId, newContent);
    },
    onToolCall: (messageId, toolCall) => {
      deps.updateMessageTools(messageId, [toolCall]);
    },
    onToolResult: () => {},
    onSessionInit: () => {},
    onComplete: (result) => {
      deps.setProcessing(false);
      deps.setStatus('', 'info');
      if (result.structuredOutput) {
        displayExtractedData(activeFile.basename, result.structuredOutput, deps);
      } else {
        deps.showTemporaryStatus('No structured output returned', 'info', 3000);
      }
      deps.saveConversation();
    },
    onError: (error) => {
      deps.setProcessing(false);
      deps.setStatus('', 'error');
      deps.showTemporaryStatus(`Extraction failed: ${error.message}`, 'error', 5000);
    },
    onStructuredOutput: () => {},
  };

  const prompt = `Analyze the following note content and extract structured information.
Extract all tasks (with completion status), suggest relevant internal links, provide a brief summary, and suggest tags.

Note: "${activeFile.basename}"
---
${content}
---`;

  try {
    await backend.sendMessage(prompt, conversation, callbacks, {
      outputFormat: { type: 'json_schema', schema: extractionSchema },
      maxTurns: 1,
      displayContent: `/extract from "${activeFile.basename}"`,
    });
  } catch (error) {
    log.error('Extract command failed', error);
    deps.setProcessing(false);
  }
}

/**
 * Display extracted structured data in a readable format.
 */
function displayExtractedData(noteName: string, data: unknown, deps: CommandHandlerDeps): void {
  const extracted = data as {
    tasks?: Array<{ text: string; completed: boolean; priority?: string }>;
    links?: Array<{ target: string; reason: string }>;
    summary?: string;
    tags?: string[];
  };

  const lines: string[] = [`**Extracted from "${noteName}":**\n`];

  if (extracted.summary) {
    lines.push(`**Summary:** ${extracted.summary}\n`);
  }

  if (extracted.tasks && extracted.tasks.length > 0) {
    lines.push('**Tasks:**');
    for (const task of extracted.tasks) {
      const status = task.completed ? '[x]' : '[ ]';
      const priority = task.priority && task.priority !== 'none' ? ` [${task.priority}]` : '';
      lines.push(`- ${status} ${task.text}${priority}`);
    }
    lines.push('');
  }

  if (extracted.links && extracted.links.length > 0) {
    lines.push('**Suggested Links:**');
    for (const link of extracted.links) {
      lines.push(`- [[${link.target}]] - ${link.reason}`);
    }
    lines.push('');
  }

  if (extracted.tags && extracted.tags.length > 0) {
    lines.push(`**Suggested Tags:** ${extracted.tags.map(t => `#${t}`).join(' ')}`);
  }

  const extractMsg: ChatMessage = {
    id: generateId(),
    role: 'assistant',
    content: lines.join('\n'),
    timestamp: Date.now(),
  };
  deps.renderMessage(extractMsg);
  deps.scrollToBottom(true);
}

/**
 * Handle /analyze command for note analysis.
 */
export async function handleAnalyzeNoteCommand(
  deps: CommandHandlerDeps
): Promise<void> {
  const backend = deps.getBackend();
  if (backend.type !== 'sdk') {
    deps.showTemporaryStatus('Structured analysis requires SDK backend', 'info', 3000);
    return;
  }

  const activeFile = deps.app.workspace.getActiveFile();
  if (!activeFile) {
    deps.showTemporaryStatus('No active note to analyze', 'info', 2000);
    return;
  }

  const content = await deps.app.vault.read(activeFile);

  const analysisSchema = {
    type: 'object',
    properties: {
      topics: { type: 'array', description: 'Main topics covered in the note', items: { type: 'string' } },
      sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative', 'mixed'], description: 'Overall sentiment' },
      readability: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['simple', 'moderate', 'complex', 'technical'] },
          score: { type: 'number', minimum: 1, maximum: 10 },
        },
        required: ['level', 'score'],
      },
      structure: {
        type: 'object',
        properties: {
          hasHeadings: { type: 'boolean' },
          hasTasks: { type: 'boolean' },
          hasLinks: { type: 'boolean' },
          hasCodeBlocks: { type: 'boolean' },
          wordCount: { type: 'number' },
        },
        required: ['hasHeadings', 'hasTasks', 'hasLinks', 'hasCodeBlocks', 'wordCount'],
      },
      improvements: {
        type: 'array',
        description: 'Suggestions for improving the note',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: ['structure', 'clarity', 'completeness', 'linking', 'metadata'] },
            suggestion: { type: 'string' },
          },
          required: ['category', 'suggestion'],
        },
      },
    },
    required: ['topics', 'sentiment', 'readability', 'structure', 'improvements'],
  };

  deps.setProcessing(true);
  deps.setStatus('Analyzing note...', 'info');

  const conversation = deps.getConversation();

  const callbacks: AgentCallbacks = {
    onMessage: (msg) => {
      conversation.messages.push(msg);
      deps.renderMessage(msg);
      deps.scrollToBottom();
    },
    onStreamingUpdate: (messageId, newContent) => {
      const msg = conversation.messages.find((m) => m.id === messageId);
      if (msg) msg.content = newContent;
      deps.updateMessageContent(messageId, newContent);
    },
    onToolCall: (messageId, toolCall) => {
      deps.updateMessageTools(messageId, [toolCall]);
    },
    onToolResult: () => {},
    onSessionInit: () => {},
    onComplete: (result) => {
      deps.setProcessing(false);
      deps.setStatus('', 'info');
      if (result.structuredOutput) {
        displayAnalysisData(activeFile.basename, result.structuredOutput, deps);
      } else {
        deps.showTemporaryStatus('No analysis data returned', 'info', 3000);
      }
      deps.saveConversation();
    },
    onError: (error) => {
      deps.setProcessing(false);
      deps.setStatus('', 'error');
      deps.showTemporaryStatus(`Analysis failed: ${error.message}`, 'error', 5000);
    },
    onStructuredOutput: () => {},
  };

  const prompt = `Analyze this note comprehensively. Identify main topics, assess sentiment and readability, describe the structure, and suggest improvements.

Note: "${activeFile.basename}"
---
${content}
---`;

  try {
    await backend.sendMessage(prompt, conversation, callbacks, {
      outputFormat: { type: 'json_schema', schema: analysisSchema },
      maxTurns: 1,
      displayContent: `/analyze "${activeFile.basename}"`,
    });
  } catch (error) {
    log.error('Analyze command failed', error);
    deps.setProcessing(false);
  }
}

/**
 * Display note analysis data in a readable format.
 */
function displayAnalysisData(noteName: string, data: unknown, deps: CommandHandlerDeps): void {
  const analysis = data as {
    topics?: string[];
    sentiment?: string;
    readability?: { level: string; score: number };
    structure?: {
      hasHeadings: boolean;
      hasTasks: boolean;
      hasLinks: boolean;
      hasCodeBlocks: boolean;
      wordCount: number;
    };
    improvements?: Array<{ category: string; suggestion: string }>;
  };

  const sentimentLabel: Record<string, string> = {
    positive: 'Positive',
    neutral: 'Neutral',
    negative: 'Negative',
    mixed: 'Mixed',
  };

  const lines: string[] = [`**Analysis of "${noteName}":**\n`];

  if (analysis.topics && analysis.topics.length > 0) {
    lines.push(`**Topics:** ${analysis.topics.join(', ')}\n`);
  }

  if (analysis.sentiment) {
    const label = sentimentLabel[analysis.sentiment] || analysis.sentiment;
    lines.push(`**Sentiment:** ${label}\n`);
  }

  if (analysis.readability) {
    lines.push(`**Readability:** ${analysis.readability.level} (${analysis.readability.score}/10)\n`);
  }

  if (analysis.structure) {
    const s = analysis.structure;
    const features = [];
    if (s.hasHeadings) features.push('headings');
    if (s.hasTasks) features.push('tasks');
    if (s.hasLinks) features.push('links');
    if (s.hasCodeBlocks) features.push('code');
    lines.push(`**Structure:** ${s.wordCount} words | Features: ${features.join(', ') || 'basic'}\n`);
  }

  if (analysis.improvements && analysis.improvements.length > 0) {
    lines.push('**Suggestions:**');
    for (const imp of analysis.improvements) {
      lines.push(`- **${imp.category}:** ${imp.suggestion}`);
    }
  }

  const analysisMsg: ChatMessage = {
    id: generateId(),
    role: 'assistant',
    content: lines.join('\n'),
    timestamp: Date.now(),
  };
  deps.renderMessage(analysisMsg);
  deps.scrollToBottom(true);
}

/**
 * Generate a note from the current conversation.
 */
export async function generateNoteFromConversation(
  args: string,
  deps: CommandHandlerDeps
): Promise<void> {
  const conversation = deps.getConversation();
  if (conversation.messages.length === 0) {
    deps.showTemporaryStatus('No messages to save', 'info', 2000);
    return;
  }

  const parts = args.split(/\s+/);
  let format = 'full';
  let targetPath = '';

  for (const part of parts) {
    if (['full', 'summary', 'q-and-a', 'qa'].includes(part.toLowerCase())) {
      format = part.toLowerCase() === 'qa' ? 'q-and-a' : part.toLowerCase();
    } else if (part) {
      targetPath = part;
    }
  }

  const sanitizedTitle = conversation.title
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 50);
  const timestamp = new Date().toISOString().slice(0, 10);
  const defaultFilename = `${sanitizedTitle}-${timestamp}.md`;

  if (!targetPath) {
    targetPath = defaultFilename;
  } else if (!targetPath.endsWith('.md')) {
    targetPath = `${targetPath}/${defaultFilename}`;
  }

  targetPath = targetPath.replace(/^\//, '');

  let content = '';
  const date = new Date(conversation.createdAt);

  // Frontmatter
  content += '---\n';
  content += `title: "${conversation.title}"\n`;
  content += `created: ${date.toISOString()}\n`;
  content += `source: claude-conversation\n`;
  if (conversation.tags && conversation.tags.length > 0) {
    content += `tags: [${conversation.tags.map(t => `"${t}"`).join(', ')}]\n`;
  }
  content += '---\n\n';

  if (format === 'full') {
    content += `# ${conversation.title}\n\n`;
    for (const msg of conversation.messages) {
      const role = msg.role === 'user' ? '**You**' : '**Claude**';
      content += `${role}:\n\n${msg.content}\n\n---\n\n`;
    }
  } else if (format === 'summary') {
    content += `# ${conversation.title} - Summary\n\n`;
    const assistantMsgs = conversation.messages.filter(m => m.role === 'assistant');
    if (assistantMsgs.length > 0) {
      const mainResponse = assistantMsgs.reduce((a, b) =>
        a.content.length > b.content.length ? a : b
      );
      content += mainResponse.content + '\n';
    }
  } else if (format === 'q-and-a') {
    content += `# ${conversation.title} - Q&A\n\n`;
    const messages = conversation.messages;
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'user') {
        const question = messages[i].content;
        const answer = messages[i + 1]?.role === 'assistant' ? messages[i + 1].content : '';
        if (answer) {
          content += `## Q: ${question.slice(0, 100)}${question.length > 100 ? '...' : ''}\n\n`;
          content += `${answer}\n\n`;
        }
      }
    }
  }

  try {
    const existingFile = deps.app.vault.getAbstractFileByPath(targetPath);
    if (existingFile) {
      deps.showTemporaryStatus(`File already exists: ${targetPath}`, 'error', 3000);
      return;
    }

    const folderPath = targetPath.substring(0, targetPath.lastIndexOf('/'));
    if (folderPath) {
      const folder = deps.app.vault.getAbstractFileByPath(folderPath);
      if (!folder) {
        await deps.app.vault.createFolder(folderPath);
      }
    }

    const file = await deps.app.vault.create(targetPath, content);
    deps.showTemporaryStatus(`Note created: ${file.path}`, 'success', 3000);

    const leaf = deps.app.workspace.getLeaf(false);
    await leaf.openFile(file);

    log.info('Generated note from conversation', { path: targetPath, format });
  } catch (error) {
    log.error('Failed to create note', error);
    deps.showTemporaryStatus(`Failed to create note: ${error}`, 'error', 3000);
  }
}

/**
 * Create a modal element with backdrop.
 */
function createModal(className: string): { modal: HTMLDivElement; content: HTMLDivElement; backdrop: HTMLDivElement } {
  const modal = document.createElement('div');
  modal.className = className;

  const backdrop = document.createElement('div');
  backdrop.className = 'rename-modal-backdrop';
  modal.appendChild(backdrop);

  const content = document.createElement('div');
  content.className = 'rename-modal-content';
  modal.appendChild(content);

  return { modal, content, backdrop };
}

/**
 * Prompt user to rename a conversation.
 */
export async function promptRenameConversation(
  id: string,
  currentTitle: string,
  deps: CommandHandlerDeps,
  onRename: (newTitle: string) => void
): Promise<void> {
  const { modal, content, backdrop } = createModal('obsidi-claude-rename-modal');

  const heading = document.createElement('h3');
  heading.textContent = 'Rename Conversation';
  content.appendChild(heading);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = currentTitle;
  content.appendChild(input);

  const actions = document.createElement('div');
  actions.className = 'rename-modal-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'mod-cta rename-save';
  saveBtn.textContent = 'Save';
  actions.appendChild(saveBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'rename-cancel';
  cancelBtn.textContent = 'Cancel';
  actions.appendChild(cancelBtn);

  content.appendChild(actions);
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();

  const saveRename = async () => {
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== currentTitle) {
      await deps.plugin.storage.renameConversation(id, newTitle);
      deps.showTemporaryStatus('Conversation renamed', 'success', 1500);
      await deps.historyRefresh();
      onRename(newTitle);
    }
    closeModal();
  };

  input.focus();
  input.select();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveRename();
    if (e.key === 'Escape') closeModal();
  });

  saveBtn.onclick = saveRename;
  cancelBtn.onclick = closeModal;
  backdrop.onclick = closeModal;
}

/**
 * Clear a container's children safely (without innerHTML).
 */
function clearChildren(container: HTMLElement): void {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

/**
 * Prompt user to manage tags on a conversation.
 */
export async function promptManageTags(
  id: string,
  currentTags: string[],
  deps: CommandHandlerDeps,
  onUpdate: (tags: string[]) => void
): Promise<void> {
  const { modal, content, backdrop } = createModal('obsidi-claude-rename-modal');

  const heading = document.createElement('h3');
  heading.textContent = 'Manage Tags';
  content.appendChild(heading);

  const tagsContainer = document.createElement('div');
  tagsContainer.className = 'tag-manager-tags';
  content.appendChild(tagsContainer);

  const renderTags = (tags: string[]) => {
    clearChildren(tagsContainer);
    if (tags.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'tag-manager-empty';
      empty.textContent = 'No tags yet';
      tagsContainer.appendChild(empty);
    } else {
      for (const tag of tags) {
        const tagEl = document.createElement('span');
        tagEl.className = 'tag-manager-tag';
        tagEl.textContent = tag;

        const removeBtn = document.createElement('span');
        removeBtn.className = 'tag-remove-btn';
        removeBtn.textContent = 'x';
        removeBtn.onclick = async () => {
          const idx = tags.indexOf(tag);
          if (idx >= 0) {
            tags.splice(idx, 1);
            await deps.plugin.storage.updateTags(id, tags);
            renderTags(tags);
          }
        };
        tagEl.appendChild(removeBtn);
        tagsContainer.appendChild(tagEl);
      }
    }
  };

  renderTags([...currentTags]);

  const inputRow = document.createElement('div');
  inputRow.className = 'tag-manager-input-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.placeholder = 'Add a tag...';
  inputRow.appendChild(input);

  const addBtn = document.createElement('button');
  addBtn.className = 'mod-cta';
  addBtn.textContent = 'Add';
  inputRow.appendChild(addBtn);

  content.appendChild(inputRow);

  const allTags = await deps.plugin.storage.getAllTags();
  const unusedTags = allTags.filter(t => !currentTags.includes(t));

  if (unusedTags.length > 0) {
    const suggestionsLabel = document.createElement('div');
    suggestionsLabel.className = 'tag-suggestions-label';
    suggestionsLabel.textContent = 'Existing tags:';
    content.appendChild(suggestionsLabel);

    const suggestions = document.createElement('div');
    suggestions.className = 'tag-suggestions';
    for (const tag of unusedTags) {
      const suggBtn = document.createElement('span');
      suggBtn.className = 'tag-suggestion';
      suggBtn.textContent = tag;
      suggBtn.onclick = async () => {
        if (!currentTags.includes(tag)) {
          currentTags.push(tag);
          await deps.plugin.storage.updateTags(id, currentTags);
          renderTags(currentTags);
          suggBtn.remove();
        }
      };
      suggestions.appendChild(suggBtn);
    }
    content.appendChild(suggestions);
  }

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'rename-modal-actions';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'rename-cancel';
  closeBtn.textContent = 'Done';
  actionsDiv.appendChild(closeBtn);

  content.appendChild(actionsDiv);
  document.body.appendChild(modal);

  const closeModal = async () => {
    modal.remove();
    await deps.historyRefresh();
    onUpdate(currentTags);
  };

  const addTag = async () => {
    const newTag = input.value.trim().toLowerCase();
    if (newTag && !currentTags.includes(newTag)) {
      currentTags.push(newTag);
      await deps.plugin.storage.updateTags(id, currentTags);
      renderTags(currentTags);
      input.value = '';
    }
  };

  input.focus();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTag();
    if (e.key === 'Escape') closeModal();
  });

  addBtn.onclick = addTag;
  closeBtn.onclick = closeModal;
  backdrop.onclick = closeModal;
}
