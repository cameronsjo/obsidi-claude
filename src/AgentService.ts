import { query, type SDKMessage, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { ObsidiClaudeSettings, ChatMessage, ToolCallInfo } from './types';
import { generateId } from './types';
import { createLogger } from './Logger';
import { findClaudeCliPath } from './claudePath';

const log = createLogger('AgentService');

// Cache the detected CLI path
let cachedCliPath: string | null = null;

export interface AgentCallbacks {
  onMessage: (message: ChatMessage) => void;
  onStreamingUpdate: (messageId: string, content: string) => void;
  onToolCall: (messageId: string, toolCall: ToolCallInfo) => void;
  onToolResult: (messageId: string, toolName: string, result: string) => void;
  onSessionInit: (sessionId: string, tools: string[]) => void;
  onComplete: (result: AgentResult) => void;
  onError: (error: Error) => void;
}

export interface AgentResult {
  success: boolean;
  totalCost?: number;
  inputTokens?: number;
  outputTokens?: number;
  errors?: string[];
}

export class AgentService {
  private settings: ObsidiClaudeSettings;
  private abortController: AbortController | null = null;
  private currentSessionId: string | null = null;

  constructor(settings: ObsidiClaudeSettings) {
    this.settings = settings;
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
    previousMessages: ChatMessage[],
    callbacks: AgentCallbacks,
    resumeSessionId?: string
  ): Promise<void> {
    this.abortController = new AbortController();
    const messagePreview = userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '');

    log.info('Sending message to agent', {
      messageLength: userMessage.length,
      previousMessageCount: previousMessages.length,
      resumeSession: !!resumeSessionId,
      model: this.settings.model,
    });
    log.debug('Message preview', { preview: messagePreview });

    // Create user message
    const userMsgId = generateId();
    callbacks.onMessage({
      id: userMsgId,
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    // Create streaming assistant message placeholder
    const assistantMsgId = generateId();
    let assistantContent = '';
    const toolCalls: Map<string, ToolCallInfo> = new Map();

    callbacks.onMessage({
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      toolCalls: [],
    });

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

      const options: Options = {
        model: this.settings.model,
        cwd,
        systemPrompt: this.settings.systemPrompt,
        permissionMode: this.settings.permissionMode,
        maxTurns: this.settings.maxTurns,
        allowedTools: this.settings.allowedTools,
        abortController: this.abortController,
        includePartialMessages: true,
        pathToClaudeCodeExecutable: cachedCliPath,
      };

      if (resumeSessionId) {
        options.resume = resumeSessionId;
      }

      const response = query({
        prompt: userMessage,
        options,
      });

      log.debug('Agent query initiated', { cwd, permissionMode: this.settings.permissionMode });

      for await (const message of response) {
        if (this.abortController?.signal.aborted) {
          log.info('Agent request aborted by user');
          break;
        }

        this.handleMessage(message, {
          assistantMsgId,
          assistantContent,
          setAssistantContent: (content: string) => {
            assistantContent = content;
          },
          toolCalls,
          callbacks,
        });
      }

      // Finalize the assistant message
      callbacks.onStreamingUpdate(assistantMsgId, assistantContent);
      log.debug('Message stream completed', { contentLength: assistantContent.length });
    } catch (error) {
      log.error('Agent request failed', error, { resumeSession: !!resumeSessionId });
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleMessage(
    message: SDKMessage,
    context: {
      assistantMsgId: string;
      assistantContent: string;
      setAssistantContent: (content: string) => void;
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
        // Handle assistant message content
        let newContent = '';
        const contentBlocks = message.message?.content;

        if (Array.isArray(contentBlocks)) {
          for (const block of contentBlocks) {
            if (block.type === 'text') {
              newContent += block.text;
            } else if (block.type === 'tool_use') {
              // Track tool use
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

        if (newContent) {
          context.setAssistantContent(context.assistantContent + newContent);
          callbacks.onStreamingUpdate(assistantMsgId, context.assistantContent + newContent);
        }
        break;
      }

      case 'stream_event': {
        // Handle streaming events for partial messages
        const event = message.event;
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const text = event.delta.text || '';
          context.setAssistantContent(context.assistantContent + text);
          callbacks.onStreamingUpdate(assistantMsgId, context.assistantContent + text);
        }
        break;
      }

      case 'tool_progress': {
        // Tool is being executed
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
        // Tool result comes as a user message
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
            }
          }
        }
        break;
      }

      case 'result': {
        // Conversation complete
        const result: AgentResult = {
          success: message.subtype === 'success',
          totalCost: message.total_cost_usd,
          inputTokens: message.usage?.input_tokens,
          outputTokens: message.usage?.output_tokens,
        };
        if (message.subtype !== 'success' && 'errors' in message) {
          result.errors = message.errors;
        }
        log.info('Agent conversation completed', {
          success: result.success,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          totalCost: result.totalCost,
          errorCount: result.errors?.length ?? 0,
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

  async resumeSession(
    sessionId: string,
    userMessage: string,
    callbacks: AgentCallbacks
  ): Promise<void> {
    return this.sendMessage(userMessage, [], callbacks, sessionId);
  }
}
