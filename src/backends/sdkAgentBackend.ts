import {
  query,
  type SDKMessage,
  type Options,
  type McpSdkServerConfigWithInstance,
  type McpServerConfig,
  type AgentDefinition,
  type ModelInfo,
  type Query,
  type AccountInfo,
  type RewindFilesResult,
} from '@anthropic-ai/claude-agent-sdk';
import type { ObsidiClaudeSettings, Conversation, ToolCallInfo } from '../types';
import { BUILTIN_AGENTS } from '../types';
import {
  type AgentBackend,
  type AgentCallbacks,
  type AgentResult,
  type BackendFeature,
  type BackendOptions,
  type AvailableModel,
  createUserMessage,
  createStreamingAssistantMessage,
  appendStreamingText,
} from './agentBackend';
import { createLogger } from '../logger';
import { findClaudeCliPath, getEnhancedPath } from '../claudePath';
import type { ObsidianTools } from '../obsidianTools';
import { createObsidianMCPServer, getObsidianToolNames } from '../obsidianMcpTools';

const log = createLogger('SDKAgentBackend');

// Cache the detected CLI path
let cachedCliPath: string | null = null;

/**
 * SDK Agent Backend for desktop.
 *
 * Uses the Claude Agent SDK which spawns Claude Code CLI as a subprocess.
 * Provides full feature set: session resume, MCP servers, hooks, subagents.
 */
export class SDKAgentBackend implements AgentBackend {
  readonly type = 'sdk' as const;

  private settings: ObsidiClaudeSettings;
  private abortController: AbortController | null = null;
  private currentSessionId: string | null = null;
  private obsidianTools: ObsidianTools;
  private obsidianMcpServer: McpSdkServerConfigWithInstance | null = null;
  private initialized = false;
  private cachedModels: ModelInfo[] | null = null;
  private activeQuery: Query | null = null;
  private cachedAccountInfo: AccountInfo | null = null;

  constructor(settings: ObsidiClaudeSettings, obsidianTools: ObsidianTools) {
    this.settings = settings;
    this.obsidianTools = obsidianTools;
  }

  /**
   * Get available models from the SDK.
   * Cached after first fetch.
   */
  getAvailableModels(): AvailableModel[] | null {
    return this.cachedModels;
  }

  /**
   * Get account info from the SDK.
   */
  getAccountInfo(): AccountInfo | null {
    return this.cachedAccountInfo;
  }

  /**
   * Rewind files to a previous state (requires file checkpointing enabled).
   * @param userMessageId - UUID of the user message to rewind to
   * @param dryRun - If true, preview changes without modifying files
   */
  async rewindFiles(userMessageId: string, dryRun = false): Promise<RewindFilesResult | null> {
    if (!this.activeQuery) {
      log.warn('Cannot rewind: no active query');
      return null;
    }
    if (!this.settings.enableFileCheckpointing) {
      log.warn('Cannot rewind: file checkpointing is disabled');
      return null;
    }
    try {
      const result = await this.activeQuery.rewindFiles(userMessageId, { dryRun });
      log.info('Rewind files result', { userMessageId, dryRun, result });
      return result;
    } catch (error) {
      log.error('Failed to rewind files', error);
      return null;
    }
  }

  /**
   * Change the permission mode mid-conversation.
   * @param mode - The permission mode to switch to
   */
  async setPermissionMode(mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk'): Promise<boolean> {
    if (!this.activeQuery) {
      log.warn('Cannot set permission mode: no active query');
      return false;
    }
    try {
      await this.activeQuery.setPermissionMode(mode);
      log.info('Permission mode changed', { mode });
      return true;
    } catch (error) {
      log.error('Failed to set permission mode', error);
      return false;
    }
  }

  /**
   * Gracefully interrupt the current query (better than abort).
   */
  async interrupt(): Promise<void> {
    if (this.activeQuery) {
      try {
        await this.activeQuery.interrupt();
        log.info('Query interrupted gracefully');
      } catch (error) {
        log.warn('Interrupt failed, falling back to abort', error);
        this.abort();
      }
    }
  }

  /**
   * Dynamically switch the model during a conversation.
   */
  async setModel(model: string): Promise<void> {
    if (!this.activeQuery) {
      log.warn('Cannot set model: no active query');
      return;
    }
    try {
      await this.activeQuery.setModel(model);
      log.info('Model switched', { model });
    } catch (error) {
      log.error('Failed to switch model', error);
    }
  }

  /**
   * Build agents configuration for the SDK query.
   */
  private buildAgents(): Record<string, AgentDefinition> | undefined {
    const agentSettings = this.settings.agents;
    if (!agentSettings?.enabled) {
      return undefined;
    }

    const agents: Record<string, AgentDefinition> = {};

    // Add built-in agents if enabled
    if (agentSettings.useBuiltinAgents) {
      for (const [name, agent] of Object.entries(BUILTIN_AGENTS)) {
        agents[name] = {
          description: agent.description,
          prompt: agent.prompt,
          model: agent.model,
          tools: agent.tools,
          maxTurns: agent.maxTurns,
        };
      }
      log.debug('Added built-in agents', { count: Object.keys(BUILTIN_AGENTS).length });
    }

    // Add custom agents
    for (const agent of agentSettings.customAgents || []) {
      if (agent.enabled) {
        agents[agent.name] = {
          description: agent.description,
          prompt: agent.prompt,
          model: agent.model,
          tools: agent.tools,
          disallowedTools: agent.disallowedTools,
          maxTurns: agent.maxTurns,
        };
      }
    }

    const count = Object.keys(agents).length;
    if (count > 0) {
      log.info('Agents configured', { count, names: Object.keys(agents) });
      return agents;
    }

    return undefined;
  }

  isAvailable(): boolean {
    // Check if Claude CLI is available
    if (!cachedCliPath) {
      cachedCliPath = findClaudeCliPath(this.settings.claudeCodePath);
    }
    return cachedCliPath !== null;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    log.info('Initializing SDK backend');

    // Set up Obsidian MCP server
    this.obsidianMcpServer = createObsidianMCPServer(this.obsidianTools, 'obsidian');
    log.info('Obsidian tools configured for SDK backend', {
      toolCount: this.obsidianTools.getToolDefinitions().length,
    });

    this.initialized = true;
  }

  async dispose(): Promise<void> {
    log.info('Disposing SDK backend');
    this.abort();
    this.obsidianMcpServer = null;
    this.initialized = false;
  }

  supports(feature: BackendFeature): boolean {
    const supportedFeatures: BackendFeature[] = [
      'session-resume',
      'mcp-servers',
      'hooks',
      'subagents',
      'file-checkpointing',
      'structured-output',
    ];
    return supportedFeatures.includes(feature);
  }

  updateSettings(settings: ObsidiClaudeSettings): void {
    // Clear cached CLI path if the setting changed
    if (settings.claudeCodePath !== this.settings.claudeCodePath) {
      cachedCliPath = null;
      log.debug('Claude CLI path setting changed, cache cleared');
    }
    this.settings = settings;
  }

  getSessionId(): string | null {
    return this.currentSessionId;
  }

  async sendMessage(
    userMessage: string,
    conversation: Conversation,
    callbacks: AgentCallbacks,
    options?: BackendOptions
  ): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    this.abortController = new AbortController();
    const messagePreview = userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '');

    // Determine session ID to resume
    const resumeSessionId = options?.resumeSessionId ??
      conversation.metadata?.sessionId ??
      conversation.sessionId; // Legacy fallback

    log.info('Sending message via SDK backend', {
      messageLength: userMessage.length,
      previousMessageCount: conversation.messages.length,
      resumeSession: !!resumeSessionId,
      model: options?.model ?? this.settings.model,
    });
    log.debug('Message preview', { preview: messagePreview });

    // Create user message for UI (use displayContent if provided, otherwise full message)
    const userMsg = createUserMessage(options?.displayContent ?? userMessage);
    callbacks.onMessage(userMsg);

    // Create streaming assistant message placeholder
    const assistantMsg = createStreamingAssistantMessage();
    let assistantContent = '';
    let needsParagraphBreak = false;
    const toolCalls: Map<string, ToolCallInfo> = new Map();

    callbacks.onMessage(assistantMsg);

    try {
      const cwd = this.settings.workingDirectory;
      if (!cwd) {
        throw new Error('Working directory not configured. Please set it in plugin settings.');
      }

      // Auto-detect Claude CLI path if not cached
      if (!cachedCliPath) {
        cachedCliPath = findClaudeCliPath(this.settings.claudeCodePath);
      }

      if (!cachedCliPath) {
        throw new Error(
          'Claude Code CLI not found. Install it via npm install -g @anthropic-ai/claude-code, or set the path manually in plugin settings.'
        );
      }

      log.debug('Using Claude CLI', { path: cachedCliPath });

      // Enhance PATH for subprocess
      const enhancedPath = getEnhancedPath();
      if (enhancedPath !== process.env.PATH) {
        process.env.PATH = enhancedPath;
        log.debug('Enhanced PATH for subprocess');
      }

      // Build allowed tools list
      const allowedTools = [...this.settings.allowedTools];
      allowedTools.push(...getObsidianToolNames(this.obsidianTools, 'obsidian'));

      // Build agents configuration
      const agents = this.buildAgents();

      // Build additional directories (include vault path)
      const additionalDirectories = [...(this.settings.additionalDirectories || [])];

      // Build betas array for extended context
      const betas: Options['betas'] = [];
      if (this.settings.extendedContext) {
        betas.push('context-1m-2025-08-07');
        log.info('Extended context (1M tokens) enabled');
      }

      // Build system prompt (either replace or append to Claude Code default)
      const userPrompt = options?.systemPrompt ?? this.settings.systemPrompt;
      const systemPrompt: Options['systemPrompt'] = this.settings.systemPromptMode === 'append'
        ? { type: 'preset', preset: 'claude_code', append: userPrompt }
        : userPrompt;

      const queryOptions: Options = {
        model: options?.model ?? this.settings.model,
        cwd,
        systemPrompt,
        permissionMode: this.settings.permissionMode,
        maxTurns: options?.maxTurns ?? this.settings.maxTurns,
        allowedTools,
        abortController: this.abortController,
        includePartialMessages: true,
        pathToClaudeCodeExecutable: cachedCliPath,
        agents,
        // Advanced SDK features
        enableFileCheckpointing: this.settings.enableFileCheckpointing,
        maxBudgetUsd: this.settings.maxBudgetUsd,
        maxThinkingTokens: this.settings.maxThinkingTokens,
        additionalDirectories: additionalDirectories.length > 0 ? additionalDirectories : undefined,
        betas: betas.length > 0 ? betas : undefined,
        disallowedTools: this.settings.disallowedTools.length > 0 ? this.settings.disallowedTools : undefined,
        // Load vault's .claude/CLAUDE.md if enabled
        settingSources: this.settings.loadVaultClaudeMd ? ['project'] : undefined,
        // Use specific agent for main conversation thread
        agent: this.settings.mainAgent || undefined,
        // Fallback model for automatic failover on rate limits/errors
        fallbackModel: this.settings.fallbackModel || undefined,
        // Ephemeral mode - don't persist sessions
        persistSession: !this.settings.ephemeralMode,
        // Sandbox settings for secure command execution
        sandbox: this.settings.sandboxEnabled
          ? {
              enabled: true,
              autoAllowBashIfSandboxed: this.settings.autoAllowBashIfSandboxed,
            }
          : undefined,
      };

      // Build MCP servers config
      const mcpServers: Record<string, McpServerConfig> = {};

      if (this.obsidianMcpServer) {
        mcpServers.obsidian = this.obsidianMcpServer;
        log.debug('Added Obsidian MCP server');
      }

      // Add external MCP servers from settings
      for (const server of this.settings.externalMcpServers) {
        if (server.enabled) {
          mcpServers[server.name] = {
            type: 'stdio',
            command: server.command,
            args: server.args,
            env: server.env,
          };
          log.debug('Added external MCP server', { name: server.name });
        }
      }

      if (Object.keys(mcpServers).length > 0) {
        queryOptions.mcpServers = mcpServers;
        log.info('MCP servers configured', { count: Object.keys(mcpServers).length });
      }

      if (resumeSessionId) {
        queryOptions.resume = resumeSessionId;
        // Fork session if requested (creates new session with copied history)
        if (options?.forkSession) {
          queryOptions.forkSession = true;
          log.info('Forking session', { sourceSessionId: resumeSessionId });
        }
      } else if (this.settings.continueSession) {
        // Auto-continue most recent session in this working directory
        queryOptions.continue = true;
        log.debug('Auto-continuing most recent session');
      }

      const response = query({
        prompt: userMessage,
        options: queryOptions,
      });

      // Store active query for control methods (interrupt, rewindFiles, etc.)
      this.activeQuery = response;

      log.debug('SDK query initiated', { cwd, permissionMode: this.settings.permissionMode });

      // Fetch available models on first query (non-blocking)
      if (!this.cachedModels) {
        response.supportedModels().then((models) => {
          this.cachedModels = models;
          log.info('Fetched available models', { count: models.length, models: models.map(m => m.value) });
        }).catch((err) => {
          log.warn('Failed to fetch models', err);
        });
      }

      // Fetch account info on first query (non-blocking)
      if (!this.cachedAccountInfo) {
        response.accountInfo().then((info) => {
          this.cachedAccountInfo = info;
          log.info('Fetched account info', { email: info.email, org: info.organization });
        }).catch((err) => {
          log.warn('Failed to fetch account info', err);
        });
      }

      for await (const message of response) {
        if (this.abortController?.signal.aborted) {
          log.info('Request aborted by user');
          break;
        }

        this.handleMessage(message, {
          assistantMsgId: assistantMsg.id,
          assistantContent,
          setAssistantContent: (content: string) => {
            assistantContent = content;
          },
          needsParagraphBreak,
          setNeedsParagraphBreak: (value: boolean) => {
            needsParagraphBreak = value;
          },
          toolCalls,
          callbacks,
        });
      }

      // Finalize the assistant message
      callbacks.onStreamingUpdate(assistantMsg.id, assistantContent);
      log.debug('Message stream completed', { contentLength: assistantContent.length });
    } catch (error) {
      log.error('SDK request failed', error, { resumeSession: !!resumeSessionId });
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      // Clear active query reference
      this.activeQuery = null;
    }
  }

  private handleMessage(
    message: SDKMessage,
    context: {
      assistantMsgId: string;
      assistantContent: string;
      setAssistantContent: (content: string) => void;
      needsParagraphBreak: boolean;
      setNeedsParagraphBreak: (value: boolean) => void;
      toolCalls: Map<string, ToolCallInfo>;
      callbacks: AgentCallbacks;
    }
  ): void {
    const { assistantMsgId, toolCalls, callbacks } = context;

    switch (message.type) {
      case 'system':
        if (message.subtype === 'init') {
          this.currentSessionId = message.session_id;
          log.info('Session initialized', {
            sessionId: message.session_id,
            toolCount: message.tools?.length ?? 0,
          });
          callbacks.onSessionInit(message.session_id, message.tools || []);
        } else if (message.subtype === 'files_persisted') {
          // Handle file changes for vault sync
          const filesPersisted = message as import('@anthropic-ai/claude-agent-sdk').SDKFilesPersistedEvent;
          const files = filesPersisted.files || [];
          const failed = filesPersisted.failed || [];

          if (files.length > 0) {
            log.info('Files persisted by Claude', {
              count: files.length,
              files: files.map(f => f.filename),
            });
            // Notify for vault refresh via callback
            if (callbacks.onFilesPersisted) {
              callbacks.onFilesPersisted(files.map(f => f.filename));
            }
          }

          if (failed.length > 0) {
            log.warn('Files failed to persist', {
              count: failed.length,
              failed: failed.map(f => ({ file: f.filename, error: f.error })),
            });
          }
        }
        break;

      case 'assistant': {
        // Capture SDK UUID for file checkpointing/rewind support
        if (message.uuid && callbacks.onSdkUuid) {
          callbacks.onSdkUuid(assistantMsgId, message.uuid);
          log.debug('Captured SDK UUID', { messageId: assistantMsgId, uuid: message.uuid });
        }

        const contentBlocks = message.message?.content;

        if (Array.isArray(contentBlocks)) {
          for (const block of contentBlocks) {
            if (block.type === 'tool_use') {
              const toolCall: ToolCallInfo = {
                name: block.name,
                input: block.input as Record<string, unknown>,
                status: 'pending',
              };
              toolCalls.set(block.id, toolCall);
              log.debug('Tool call initiated', { tool: block.name, toolUseId: block.id });
              if (this.settings.showToolCalls) {
                callbacks.onToolCall(assistantMsgId, toolCall);
              }
            }
          }
        }
        break;
      }

      case 'stream_event': {
        const event = message.event;
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const text = event.delta.text || '';
          appendStreamingText(text, context, assistantMsgId, callbacks);
        }
        break;
      }

      case 'tool_progress': {
        const toolCall = toolCalls.get(message.tool_use_id);
        if (toolCall && toolCall.status === 'pending') {
          toolCall.status = 'running';
          if (this.settings.showToolCalls) {
            callbacks.onToolCall(assistantMsgId, toolCall);
          }
        }
        break;
      }

      case 'user': {
        if (message.tool_use_result !== undefined) {
          const toolUseId = message.parent_tool_use_id;
          if (toolUseId) {
            const toolCall = toolCalls.get(toolUseId);
            if (toolCall) {
              toolCall.status = 'completed';
              toolCall.result =
                typeof message.tool_use_result === 'string'
                  ? message.tool_use_result
                  : JSON.stringify(message.tool_use_result);
              log.debug('Tool call completed', {
                tool: toolCall.name,
                resultLength: toolCall.result.length,
              });
              if (this.settings.showToolCalls) {
                callbacks.onToolResult(assistantMsgId, toolCall.name, toolCall.result);
              }

              if (context.assistantContent.trim()) {
                context.setNeedsParagraphBreak(true);
              }
            }
          }
        }
        break;
      }

      case 'result': {
        const result: AgentResult = {
          success: message.subtype === 'success',
          totalCost: message.total_cost_usd,
          inputTokens: message.usage?.input_tokens,
          outputTokens: message.usage?.output_tokens,
        };
        if (message.subtype !== 'success' && 'errors' in message) {
          result.errors = message.errors;
        }
        log.info('SDK conversation completed', {
          success: result.success,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          totalCost: result.totalCost,
        });
        callbacks.onComplete(result);
        break;
      }
    }
  }

  abort(): void {
    // Try graceful interrupt first, fall back to abort
    if (this.activeQuery) {
      this.activeQuery.interrupt().catch(() => {
        // If interrupt fails, force abort
        if (this.abortController) {
          this.abortController.abort();
        }
      });
    } else if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = null;
    this.activeQuery = null;
  }
}
