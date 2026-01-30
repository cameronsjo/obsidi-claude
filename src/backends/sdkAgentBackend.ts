import {
  query,
  type SDKMessage,
  type Options,
  type McpSdkServerConfigWithInstance,
  type McpServerConfig,
} from '@anthropic-ai/claude-agent-sdk';
import type { ObsidiClaudeSettings, Conversation, ToolCallInfo } from '../types';
import {
  type AgentBackend,
  type AgentCallbacks,
  type AgentResult,
  type BackendFeature,
  type BackendOptions,
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

  constructor(settings: ObsidiClaudeSettings, obsidianTools: ObsidianTools) {
    this.settings = settings;
    this.obsidianTools = obsidianTools;
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

      const queryOptions: Options = {
        model: options?.model ?? this.settings.model,
        cwd,
        systemPrompt: options?.systemPrompt ?? this.settings.systemPrompt,
        permissionMode: this.settings.permissionMode,
        maxTurns: options?.maxTurns ?? this.settings.maxTurns,
        allowedTools,
        abortController: this.abortController,
        includePartialMessages: true,
        pathToClaudeCodeExecutable: cachedCliPath,
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
      }

      const response = query({
        prompt: userMessage,
        options: queryOptions,
      });

      log.debug('SDK query initiated', { cwd, permissionMode: this.settings.permissionMode });

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
        }
        break;

      case 'assistant': {
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
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
