import Anthropic from '@anthropic-ai/sdk';
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
  type HookEvent,
  type HookCallbackMatcher,
  type HookInput,
  type HookJSONOutput,
  type PostToolUseHookInput,
  type PreToolUseHookInput,
  type NotificationHookInput,
  type PreCompactHookInput,
  type SDKResultSuccess,
  type SDKTaskNotificationMessage,
  type SDKCompactBoundaryMessage,
  type SDKStatusMessage,
  type SDKStatus,
  type CanUseTool,
  type PermissionResult,
  type PermissionUpdate,
  type SpawnOptions,
  type SpawnedProcess,
  // V2 API (unstable/alpha)
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type SDKSession,
  type SDKSessionOptions,
  type SdkPluginConfig,
} from '@anthropic-ai/claude-agent-sdk';
import type { ObsidiClaudeSettings, Conversation, ToolCallInfo, SpawnConfig } from '../types';
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
/**
 * Callbacks for hook events that need to communicate back to the UI.
 */
/**
 * Permission request context passed to the UI handler.
 */
export interface PermissionRequestContext {
  toolName: string;
  input: Record<string, unknown>;
  toolUseID: string;
  decisionReason?: string;
  blockedPath?: string;
  suggestions?: PermissionUpdate[];
  agentID?: string;
}

/**
 * User's response to a permission request.
 */
export interface PermissionResponse {
  /** Whether the user allowed the action */
  allowed: boolean;
  /** If true and allowed, apply suggestions for "always allow" */
  applyAlwaysAllow?: boolean;
  /** Optional message to include in deny response */
  denyMessage?: string;
  /** If true and denied, interrupt the entire conversation */
  interrupt?: boolean;
}

export interface HookCallbacks {
  /** Called when vault should be refreshed (after file edits) */
  onVaultRefresh?: () => void;
  /** Called when a notification should be shown */
  onNotification?: (title: string, message: string, type: 'info' | 'warning' | 'error') => void;
  /** Called when a tool is blocked by hooks */
  onToolBlocked?: (toolName: string, reason: string) => void;
  /** Called when audit logging is enabled (logs tool usage) */
  onAuditLog?: (toolName: string, input: unknown, output: unknown) => void;
  /** Called when a permission request needs user input (returns user's decision) */
  onPermissionRequest?: (context: PermissionRequestContext) => Promise<PermissionResponse>;
}

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
  private hookCallbacks: HookCallbacks = {};
  /** V2 API session (unstable) */
  private v2Session: SDKSession | null = null;
  private apiKeyProvider: (() => Promise<string | null>) | null = null;

  constructor(settings: ObsidiClaudeSettings, obsidianTools: ObsidianTools) {
    this.settings = settings;
    this.obsidianTools = obsidianTools;
  }

  /**
   * Set the API key provider for secure storage access.
   */
  setApiKeyProvider(provider: () => Promise<string | null>): void {
    this.apiKeyProvider = provider;
  }

  /**
   * Set callbacks for hook events.
   */
  setHookCallbacks(callbacks: HookCallbacks): void {
    this.hookCallbacks = callbacks;
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
   * Get MCP server status information.
   */
  async getMcpServerStatus(): Promise<Array<{
    name: string;
    status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
    error?: string;
    toolCount?: number;
  }> | null> {
    if (!this.activeQuery) {
      log.warn('Cannot get MCP status: no active query');
      return null;
    }
    try {
      const statuses = await this.activeQuery.mcpServerStatus();
      return statuses.map(s => ({
        name: s.name,
        status: s.status,
        error: s.error,
        toolCount: s.tools?.length,
      }));
    } catch (error) {
      log.error('Failed to get MCP server status', error);
      return null;
    }
  }

  /**
   * Reconnect a failed MCP server.
   */
  async reconnectMcpServer(name: string): Promise<boolean> {
    if (!this.activeQuery) {
      log.warn('Cannot reconnect MCP server: no active query');
      return false;
    }
    try {
      await this.activeQuery.reconnectMcpServer(name);
      log.info('MCP server reconnected', { name });
      return true;
    } catch (error) {
      log.error('Failed to reconnect MCP server', error);
      return false;
    }
  }

  /**
   * Toggle MCP server enabled state.
   */
  async toggleMcpServer(name: string, enabled: boolean): Promise<boolean> {
    if (!this.activeQuery) {
      log.warn('Cannot toggle MCP server: no active query');
      return false;
    }
    try {
      await this.activeQuery.toggleMcpServer(name, enabled);
      log.info('MCP server toggled', { name, enabled });
      return true;
    } catch (error) {
      log.error('Failed to toggle MCP server', error);
      return false;
    }
  }

  /**
   * Dynamically add, remove, or reconfigure MCP servers at runtime.
   * Pass the new desired server configuration - servers not in the config are removed.
   */
  async setMcpServers(
    servers: Record<string, McpServerConfig>
  ): Promise<{ added: string[]; removed: string[]; errors: Record<string, string> } | null> {
    if (!this.activeQuery) {
      log.warn('Cannot set MCP servers: no active query');
      return null;
    }
    try {
      const result = await this.activeQuery.setMcpServers(servers);
      log.info('MCP servers updated', {
        added: result.added,
        removed: result.removed,
        errors: Object.keys(result.errors),
      });
      return result;
    } catch (error) {
      log.error('Failed to set MCP servers', error);
      return null;
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
          skills: agent.skills,
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
          skills: agent.skills,
          mcpServers: agent.mcpServers,
          maxTurns: agent.maxTurns,
          // EXPERIMENTAL: Critical reminder that must not be forgotten
          criticalSystemReminder_EXPERIMENTAL: agent.criticalSystemReminder,
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

  /**
   * Build hooks configuration for the SDK query.
   * Hooks enable custom behavior at key events: tool execution, notifications, etc.
   */
  private buildHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined {
    const hookSettings = this.settings.hooks;
    if (!hookSettings?.enabled) {
      return undefined;
    }

    const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};

    // PreToolUse hook - block dangerous tools and add audit logging
    if (hookSettings.blockedTools.length > 0 || hookSettings.auditToolUsage) {
      hooks.PreToolUse = [{
        hooks: [async (input: HookInput): Promise<HookJSONOutput> => {
          const preToolInput = input as PreToolUseHookInput;
          const toolName = preToolInput.tool_name;

          // Block tools if configured
          if (hookSettings.blockedTools.includes(toolName)) {
            log.info('Hook blocked tool', { toolName });
            this.hookCallbacks.onToolBlocked?.(toolName, 'Tool is in blocked list');
            return {
              continue: true,
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: `Tool "${toolName}" is blocked by plugin settings`,
              },
            };
          }

          // Continue with default behavior
          return { continue: true };
        }],
      }];
    }

    // PostToolUse hook - auto-refresh vault after file edits and audit logging
    if (hookSettings.autoRefreshVault || hookSettings.auditToolUsage) {
      const fileEditTools = ['Edit', 'Write', 'NotebookEdit', 'mcp__obsidian__create_note', 'mcp__obsidian__append_to_note', 'mcp__obsidian__rename_note'];

      hooks.PostToolUse = [{
        hooks: [async (input: HookInput): Promise<HookJSONOutput> => {
          const postToolInput = input as PostToolUseHookInput;
          const toolName = postToolInput.tool_name;

          // Audit logging
          if (hookSettings.auditToolUsage) {
            log.debug('Tool usage audit', {
              tool: toolName,
              inputSize: JSON.stringify(postToolInput.tool_input).length,
            });
            this.hookCallbacks.onAuditLog?.(
              toolName,
              postToolInput.tool_input,
              postToolInput.tool_response
            );
          }

          // Auto-refresh vault after file edits
          if (hookSettings.autoRefreshVault && fileEditTools.some(t => toolName.includes(t))) {
            log.debug('Auto-refreshing vault after file edit', { toolName });
            this.hookCallbacks.onVaultRefresh?.();
          }

          return { continue: true };
        }],
      }];
    }

    // Notification hook - show SDK notifications in Obsidian
    if (hookSettings.showNotifications) {
      hooks.Notification = [{
        hooks: [async (input: HookInput): Promise<HookJSONOutput> => {
          const notifInput = input as NotificationHookInput;
          const message = notifInput.message || '';
          const type = notifInput.level === 'error' ? 'error'
            : notifInput.level === 'warning' ? 'warning'
            : 'info';

          this.hookCallbacks.onNotification?.('Claude', message, type);

          return { continue: true };
        }],
      }];
    }

    // PreCompact hook - inject custom compaction instructions
    if (this.settings.compactionInstructions) {
      hooks.PreCompact = [{
        hooks: [async (input: HookInput): Promise<HookJSONOutput> => {
          const preCompactInput = input as PreCompactHookInput;
          log.info('PreCompact hook triggered', {
            trigger: preCompactInput.trigger,
            existingInstructions: preCompactInput.custom_instructions?.slice(0, 50),
          });

          // Combine existing instructions with vault-specific ones
          const vaultContext = this.settings.compactionInstructions || '';
          const combined = preCompactInput.custom_instructions
            ? `${preCompactInput.custom_instructions}\n\n${vaultContext}`
            : vaultContext;

          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'PreCompact' as const,
              customInstructions: combined,
            },
          };
        }],
      }];
    }

    const hookCount = Object.keys(hooks).length;
    if (hookCount > 0) {
      log.info('Hooks configured', {
        events: Object.keys(hooks),
        autoRefreshVault: hookSettings.autoRefreshVault,
        auditToolUsage: hookSettings.auditToolUsage,
        showNotifications: hookSettings.showNotifications,
        blockedToolsCount: hookSettings.blockedTools.length,
      });
      return hooks;
    }

    return undefined;
  }

  /**
   * Builds the canUseTool callback for custom permission UI.
   * This enables native Obsidian modals instead of CLI prompts.
   */
  private buildCanUseTool(): CanUseTool {
    return async (
      toolName: string,
      input: Record<string, unknown>,
      options: {
        signal: AbortSignal;
        suggestions?: PermissionUpdate[];
        blockedPath?: string;
        decisionReason?: string;
        toolUseID: string;
        agentID?: string;
      }
    ): Promise<PermissionResult> => {
      log.info('Permission request for tool', {
        toolName,
        toolUseID: options.toolUseID,
        agentID: options.agentID,
        decisionReason: options.decisionReason,
        blockedPath: options.blockedPath,
      });

      // Check for abort signal
      if (options.signal.aborted) {
        return {
          behavior: 'deny',
          message: 'Request aborted',
          toolUseID: options.toolUseID,
        };
      }

      // Invoke the UI callback to show permission modal
      if (!this.hookCallbacks.onPermissionRequest) {
        // Fallback: allow if no callback set (shouldn't happen)
        log.warn('No permission callback set, allowing by default');
        return {
          behavior: 'allow',
          toolUseID: options.toolUseID,
        };
      }

      try {
        const response = await this.hookCallbacks.onPermissionRequest({
          toolName,
          input,
          toolUseID: options.toolUseID,
          decisionReason: options.decisionReason,
          blockedPath: options.blockedPath,
          suggestions: options.suggestions,
          agentID: options.agentID,
        });

        if (response.allowed) {
          log.info('Permission granted', { toolName, applyAlwaysAllow: response.applyAlwaysAllow });
          return {
            behavior: 'allow',
            // Apply "always allow" suggestions if user chose that option
            updatedPermissions: response.applyAlwaysAllow ? options.suggestions : undefined,
            toolUseID: options.toolUseID,
          };
        } else {
          log.info('Permission denied', { toolName, message: response.denyMessage, interrupt: response.interrupt });
          return {
            behavior: 'deny',
            message: response.denyMessage || 'User denied permission',
            interrupt: response.interrupt,
            toolUseID: options.toolUseID,
          };
        }
      } catch (error) {
        log.error('Permission callback failed', { toolName, error });
        return {
          behavior: 'deny',
          message: `Permission handler error: ${error instanceof Error ? error.message : String(error)}`,
          toolUseID: options.toolUseID,
        };
      }
    };
  }

  /**
   * Build plugins configuration for SDK query.
   * Combines configured plugins with auto-discovered vault plugins.
   */
  private buildPlugins(): SdkPluginConfig[] | undefined {
    const pluginSettings = this.settings.pluginSettings;
    if (!pluginSettings?.enabled) {
      return undefined;
    }

    const plugins: SdkPluginConfig[] = [];

    // Add configured plugins that are enabled
    for (const plugin of pluginSettings.plugins || []) {
      if (plugin.enabled) {
        plugins.push({
          type: 'local',
          path: plugin.path,
        });
        log.debug('Added plugin', { name: plugin.name, path: plugin.path });
      }
    }

    // Auto-discover vault plugins if enabled
    if (pluginSettings.autoDiscoverVaultPlugins && this.settings.workingDirectory) {
      const vaultPluginDir = `${this.settings.workingDirectory}/.claude-plugins`;
      try {
        const fs = require('fs');
        if (fs.existsSync(vaultPluginDir)) {
          const entries = fs.readdirSync(vaultPluginDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const pluginPath = `${vaultPluginDir}/${entry.name}`;
              // Check if it looks like a plugin (has package.json or main.js)
              if (fs.existsSync(`${pluginPath}/package.json`) || fs.existsSync(`${pluginPath}/main.js`)) {
                plugins.push({
                  type: 'local',
                  path: pluginPath,
                });
                log.debug('Auto-discovered vault plugin', { name: entry.name, path: pluginPath });
              }
            }
          }
        }
      } catch (error) {
        log.warn('Failed to auto-discover vault plugins', error);
      }
    }

    if (plugins.length > 0) {
      log.info('Plugins configured', { count: plugins.length, paths: plugins.map(p => p.path) });
      return plugins;
    }

    return undefined;
  }

  /**
   * Get or create a V2 session for multi-turn conversations.
   * @experimental V2 API is marked as @alpha and may change.
   */
  private getOrCreateV2Session(
    resumeSessionId?: string,
    model?: string,
    cwd?: string
  ): SDKSession {
    // Build session options
    const sessionOptions: SDKSessionOptions = {
      model: model || this.settings.model,
      pathToClaudeCodeExecutable: cachedCliPath || undefined,
      allowedTools: this.settings.allowedTools,
      disallowedTools: this.settings.disallowedTools.length > 0 ? this.settings.disallowedTools : undefined,
    };

    // Resume existing session or create new one
    if (resumeSessionId) {
      log.info('Resuming V2 session', { sessionId: resumeSessionId });
      return unstable_v2_resumeSession(resumeSessionId, sessionOptions);
    }

    log.info('Creating new V2 session', { model: sessionOptions.model, cwd });
    return unstable_v2_createSession(sessionOptions);
  }

  /**
   * Close any active V2 session.
   */
  private closeV2Session(): void {
    if (this.v2Session) {
      try {
        this.v2Session.close();
        log.debug('V2 session closed');
      } catch (error) {
        log.warn('Failed to close V2 session', error);
      }
      this.v2Session = null;
    }
  }

  /**
   * Builds the spawnClaudeCodeProcess function for custom execution environments.
   * Supports Docker containers and SSH remote execution.
   */
  private buildSpawnFunction(config: SpawnConfig): ((options: SpawnOptions) => SpawnedProcess) | undefined {
    if (config.mode === 'local') {
      return undefined; // Use default spawning
    }

    return (options: SpawnOptions): SpawnedProcess => {
      const { spawn } = require('child_process');
      let proc: ReturnType<typeof spawn>;

      if (config.mode === 'docker') {
        // Docker execution
        const dockerArgs = [
          'run',
          '--rm',
          '-i', // Interactive for stdin
          ...(config.dockerOptions || []),
          // Mount working directory
          '-v', `${options.cwd}:${options.cwd}`,
          '-w', options.cwd,
          // Pass through environment
          ...Object.entries({ ...options.env, ...config.env }).map(
            ([k, v]) => ['-e', `${k}=${v}`]
          ).flat(),
          config.dockerImage || 'anthropic/claude-code:latest',
          options.command,
          ...(options.args || []),
        ];

        log.info('Spawning Claude in Docker', {
          image: config.dockerImage,
          cwd: options.cwd,
        });

        proc = spawn('docker', dockerArgs, {
          cwd: options.cwd,
          env: options.env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else if (config.mode === 'ssh') {
        // SSH remote execution
        const sshArgs = [
          ...(config.sshKeyPath ? ['-i', config.sshKeyPath] : []),
          `${config.sshUser || 'claude'}@${config.sshHost}`,
          // Remote command with environment
          `cd ${options.cwd} && ${Object.entries({ ...options.env, ...config.env })
            .map(([k, v]) => `${k}='${v}'`)
            .join(' ')} ${options.command} ${(options.args || []).join(' ')}`,
        ];

        log.info('Spawning Claude via SSH', {
          host: config.sshHost,
          user: config.sshUser,
          cwd: options.cwd,
        });

        proc = spawn('ssh', sshArgs, {
          cwd: options.cwd,
          env: options.env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else {
        throw new Error(`Unknown spawn mode: ${config.mode}`);
      }

      // Handle abort signal
      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          proc.kill('SIGTERM');
        });
      }

      return {
        stdout: proc.stdout,
        stderr: proc.stderr,
        stdin: proc.stdin,
        pid: proc.pid ?? 0,
        on: (event: string, callback: (...args: unknown[]) => void) => {
          proc.on(event, callback);
        },
        kill: (signal?: NodeJS.Signals | number) => {
          proc.kill(signal);
          return true;
        },
      };
    };
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
    this.closeV2Session();
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

      // Build hooks configuration
      const hooks = this.buildHooks();

      // Build plugins configuration
      const plugins = this.buildPlugins();

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
        // SDK hooks for custom event handling
        hooks,
        // Structured output format (JSON Schema)
        outputFormat: options?.outputFormat,
        // Custom permission prompt routing via MCP tool
        permissionPromptToolName: this.settings.permissionPromptToolName || undefined,
        // Custom permission handler for native UI prompts
        canUseTool: this.hookCallbacks.onPermissionRequest
          ? this.buildCanUseTool()
          : undefined,
        // Stderr callback for subprocess debugging
        stderr: (data: string) => {
          log.debug('Claude CLI stderr', { data: data.trim() });
        },
        // Extra CLI arguments for advanced use (--verbose, --debug, etc.)
        extraArgs: this.settings.extraArgs && Object.keys(this.settings.extraArgs).length > 0
          ? this.settings.extraArgs
          : undefined,
        // Strict MCP config validation - errors instead of warnings
        strictMcpConfig: this.settings.strictMcpConfig || undefined,
        // Custom spawn function for Docker/SSH execution
        spawnClaudeCodeProcess: this.settings.spawnConfig && this.settings.spawnConfig.mode !== 'local'
          ? this.buildSpawnFunction(this.settings.spawnConfig)
          : undefined,
        // Load external plugins
        plugins,
      };

      // Build MCP servers config
      const mcpServers: Record<string, McpServerConfig> = {};

      if (this.obsidianMcpServer) {
        mcpServers.obsidian = this.obsidianMcpServer;
        log.debug('Added Obsidian MCP server');
      }

      // Add external MCP servers from settings (supporting stdio, http, sse transports)
      for (const server of this.settings.externalMcpServers) {
        if (server.enabled) {
          const transport = server.transport || 'stdio';

          if (transport === 'http' && server.url) {
            mcpServers[server.name] = {
              type: 'http',
              url: server.url,
              headers: server.headers,
            };
            log.debug('Added HTTP MCP server', { name: server.name, url: server.url });
          } else if (transport === 'sse' && server.url) {
            mcpServers[server.name] = {
              type: 'sse',
              url: server.url,
              headers: server.headers,
            };
            log.debug('Added SSE MCP server', { name: server.name, url: server.url });
          } else if (transport === 'stdio' && server.command) {
            mcpServers[server.name] = {
              type: 'stdio',
              command: server.command,
              args: server.args || [],
              env: server.env,
            };
            log.debug('Added stdio MCP server', { name: server.name, command: server.command });
          } else {
            log.warn('Invalid MCP server configuration, skipping', {
              name: server.name,
              transport,
              hasUrl: !!server.url,
              hasCommand: !!server.command,
            });
          }
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
        // Resume at specific message UUID (go back in time)
        if (options?.resumeSessionAt) {
          queryOptions.resumeSessionAt = options.resumeSessionAt;
          log.info('Resuming at specific message', { uuid: options.resumeSessionAt });
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
        } else if (message.subtype === 'task_notification') {
          // Handle background task (subagent) notifications
          const taskNotif = message as SDKTaskNotificationMessage;
          log.info('Background task notification', {
            taskId: taskNotif.task_id,
            status: taskNotif.status,
            summary: taskNotif.summary,
            outputFile: taskNotif.output_file,
          });
          if (callbacks.onTaskNotification) {
            callbacks.onTaskNotification(
              taskNotif.task_id,
              taskNotif.status,
              taskNotif.summary,
              taskNotif.output_file
            );
          }
        } else if (message.subtype === 'compact_boundary') {
          // Handle compaction boundary marker
          const compactMsg = message as SDKCompactBoundaryMessage;
          log.info('Context compaction boundary', {
            trigger: compactMsg.compact_metadata.trigger,
            preTokens: compactMsg.compact_metadata.pre_tokens,
          });
          if (callbacks.onCompactionBoundary) {
            callbacks.onCompactionBoundary(
              compactMsg.compact_metadata.trigger,
              compactMsg.compact_metadata.pre_tokens
            );
          }
        } else if (message.subtype === 'status') {
          // Handle status changes (compacting)
          const statusMsg = message as SDKStatusMessage;
          log.debug('Status update', { status: statusMsg.status });
          if (callbacks.onCompactionStatus) {
            callbacks.onCompactionStatus(statusMsg.status);
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

              // Always add paragraph break after tool results for visual separation
              context.setNeedsParagraphBreak(true);
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
        // Handle structured output if present
        if (message.subtype === 'success') {
          const successMsg = message as SDKResultSuccess;
          if (successMsg.structured_output !== undefined) {
            result.structuredOutput = successMsg.structured_output;
            log.info('Structured output received', {
              type: typeof successMsg.structured_output,
              preview: JSON.stringify(successMsg.structured_output).slice(0, 100),
            });
            callbacks.onStructuredOutput?.(successMsg.structured_output);
          }
        }
        log.info('SDK conversation completed', {
          success: result.success,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          totalCost: result.totalCost,
          hasStructuredOutput: !!result.structuredOutput,
        });
        callbacks.onComplete(result);
        break;
      }

      case 'tool_use_summary': {
        // Human-readable summary of tool operations
        const summaryMessage = message as { summary?: string };
        if (summaryMessage.summary && callbacks.onToolSummary) {
          log.debug('Tool use summary', { summary: summaryMessage.summary });
          callbacks.onToolSummary(assistantMsgId, summaryMessage.summary);
        }
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

  /**
   * Generate a conversation title using Haiku for speed.
   * Uses direct API call to avoid spawning a subprocess.
   */
  async generateTitle(firstUserMessage: string, firstAssistantMessage: string): Promise<string | null> {
    // Try secure storage first, then env var, then legacy settings
    let apiKey: string | null = null;
    if (this.apiKeyProvider) {
      apiKey = await this.apiKeyProvider();
    }
    if (!apiKey) {
      apiKey = process.env.ANTHROPIC_API_KEY || this.settings.anthropicApiKey || null;
    }

    if (!apiKey) {
      log.debug('No API key for title generation, using fallback');
      return null;
    }

    try {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 30,
        messages: [
          {
            role: 'user',
            content: `Generate a short title (3-6 words, no quotes) for this conversation:\n\nUser: ${firstUserMessage.slice(0, 500)}\n\nAssistant: ${firstAssistantMessage.slice(0, 500)}`,
          },
        ],
      });

      const textBlock = response.content.find(b => b.type === 'text');
      if (textBlock && textBlock.type === 'text') {
        return textBlock.text.trim().replace(/^["']|["']$/g, '');
      }
      return null;
    } catch (error) {
      log.warn('Failed to generate title', error);
      return null;
    }
  }
}
