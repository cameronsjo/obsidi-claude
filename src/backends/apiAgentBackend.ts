import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ContentBlockParam,
  ToolUseBlock,
  TextBlock,
  ToolResultBlockParam,
  Tool,
} from '@anthropic-ai/sdk/resources/messages';
import type { ObsidiClaudeSettings, Conversation, ChatMessage, ToolCallInfo } from '../types';
import { generateId, MODEL_ID_MAP } from '../types';
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
import type { ObsidianTools } from '../obsidianTools';

const log = createLogger('APIAgentBackend');

/**
 * API Agent Backend for mobile (and desktop fallback).
 *
 * Uses the direct Anthropic API without spawning any subprocesses.
 * More limited features but works everywhere.
 */
export class APIAgentBackend implements AgentBackend {
  readonly type = 'api' as const;

  private settings: ObsidiClaudeSettings;
  private client: Anthropic | null = null;
  private abortController: AbortController | null = null;
  private obsidianTools: ObsidianTools;
  private initialized = false;

  constructor(settings: ObsidiClaudeSettings, obsidianTools: ObsidianTools) {
    this.settings = settings;
    this.obsidianTools = obsidianTools;
  }

  isAvailable(): boolean {
    // Available if we have an API key (from env or settings)
    return this.getApiKey() !== null;
  }

  private getApiKey(): string | null {
    // Check environment variable first, then settings
    const envKey = process.env.ANTHROPIC_API_KEY;
    if (envKey) return envKey;

    const settingsKey = this.settings.anthropicApiKey;
    if (settingsKey) return settingsKey;

    return null;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    log.info('Initializing API backend');

    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error(
        'Anthropic API key not found. Set ANTHROPIC_API_KEY environment variable or configure in plugin settings.'
      );
    }

    this.client = new Anthropic({ apiKey });
    this.initialized = true;

    log.info('API backend initialized', {
      toolCount: this.obsidianTools.getToolDefinitions().length,
    });
  }

  async dispose(): Promise<void> {
    log.info('Disposing API backend');
    this.abort();
    this.client = null;
    this.initialized = false;
  }

  supports(feature: BackendFeature): boolean {
    // API backend has limited features
    const supportedFeatures: BackendFeature[] = ['structured-output'];
    return supportedFeatures.includes(feature);
  }

  updateSettings(settings: ObsidiClaudeSettings): void {
    this.settings = settings;

    // Reinitialize client if API key changed
    const newKey = this.getApiKey();
    if (this.initialized && newKey) {
      this.client = new Anthropic({ apiKey: newKey });
    }
  }

  getSessionId(): string | null {
    // API backend doesn't have sessions
    return null;
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

    if (!this.client) {
      throw new Error('API client not initialized');
    }

    this.abortController = new AbortController();
    const messagePreview = userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '');

    log.info('Sending message via API backend', {
      messageLength: userMessage.length,
      previousMessageCount: conversation.messages.length,
      model: options?.model ?? this.settings.model,
    });
    log.debug('Message preview', { preview: messagePreview });

    // Create user message for UI (use displayContent if provided, otherwise full message)
    const userMsg = createUserMessage(options?.displayContent ?? userMessage);
    callbacks.onMessage(userMsg);

    // Emit a fake session init for compatibility
    callbacks.onSessionInit('api-backend', this.getToolNames());

    // Convert conversation history to API format
    const messages = this.convertToApiMessages(conversation.messages);
    messages.push({ role: 'user', content: userMessage });

    // Create streaming assistant message
    const assistantMsg = createStreamingAssistantMessage();
    callbacks.onMessage(assistantMsg);

    try {
      await this.processConversation(
        messages,
        assistantMsg.id,
        callbacks,
        options
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        log.info('Request aborted by user');
        return;
      }
      log.error('API request failed', error);
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Process the conversation with the API, handling tool calls in a loop.
   *
   * All turns update the same assistant message to avoid multiple bubbles.
   */
  private async processConversation(
    messages: MessageParam[],
    assistantMsgId: string,
    callbacks: AgentCallbacks,
    options?: BackendOptions,
    turnCount = 0,
    accumulatedContent = '',
    accumulatedToolCalls: ToolCallInfo[] = []
  ): Promise<void> {
    const maxTurns = options?.maxTurns ?? this.settings.maxTurns;

    if (turnCount >= maxTurns) {
      log.warn('Max turns reached', { maxTurns });
      callbacks.onComplete({
        success: true,
        errors: ['Max turns reached'],
      });
      return;
    }

    // Continue accumulating from previous turns
    let assistantContent = accumulatedContent;
    const toolCalls: ToolCallInfo[] = [...accumulatedToolCalls];
    const toolUseBlocks: ToolUseBlock[] = [];

    // Stream the response
    const stream = await this.client!.messages.stream({
      model: this.getModelId(options?.model),
      max_tokens: 8192,
      system: options?.systemPrompt ?? this.settings.systemPrompt,
      messages,
      tools: this.getToolDefinitions(),
    }, {
      signal: this.abortController?.signal,
    });

    // Track if we need a paragraph break before new text (after tool results)
    let needsParagraphBreak = turnCount > 0 && assistantContent.trim().length > 0;

    // Create streaming context for the helper function
    const streamingContext = {
      get assistantContent() { return assistantContent; },
      setAssistantContent: (content: string) => { assistantContent = content; },
      get needsParagraphBreak() { return needsParagraphBreak; },
      setNeedsParagraphBreak: (value: boolean) => { needsParagraphBreak = value; },
    };

    // Track current content block type for proper paragraph breaks
    let currentBlockType: string | null = null;

    // Process streaming events
    for await (const event of stream) {
      if (this.abortController?.signal.aborted) {
        break;
      }

      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          appendStreamingText(event.delta.text, streamingContext, assistantMsgId, callbacks);
        } else if (event.delta.type === 'input_json_delta') {
          // Tool input is being streamed - we'll handle it at content_block_stop
        }
      } else if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          const toolCall: ToolCallInfo = {
            name: event.content_block.name,
            input: {},
            status: 'pending',
          };
          toolCalls.push(toolCall);
          if (this.settings.showToolCalls) {
            callbacks.onToolCall(assistantMsgId, toolCall);
          }
        } else if (event.content_block.type === 'text') {
          // If we had a previous text block, add paragraph break before new one
          if (currentBlockType === 'text' && assistantContent.trim()) {
            needsParagraphBreak = true;
          }
        }
        currentBlockType = event.content_block.type;
      } else if (event.type === 'content_block_stop') {
        // Content block finished - keep track for paragraph breaks
      } else if (event.type === 'message_stop') {
        // Message complete
      }
    }

    // Get final message to extract tool use blocks
    const finalMessage = await stream.finalMessage();

    // Extract tool use blocks
    for (const block of finalMessage.content) {
      if (block.type === 'tool_use') {
        toolUseBlocks.push(block);
        // Update tool call with full input
        const toolCall = toolCalls.find(tc => tc.name === block.name && !tc.input.id);
        if (toolCall) {
          toolCall.input = block.input as Record<string, unknown>;
          toolCall.status = 'running';
          if (this.settings.showToolCalls) {
            callbacks.onToolCall(assistantMsgId, toolCall);
          }
        }
      }
    }

    // Finalize content
    callbacks.onStreamingUpdate(assistantMsgId, assistantContent);

    // If no tool calls, we're done
    if (toolUseBlocks.length === 0) {
      log.info('API conversation completed (no tool calls)', {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      });
      callbacks.onComplete({
        success: true,
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      });
      return;
    }

    // Execute tool calls
    const toolResults: ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const toolCall = toolCalls.find(tc => tc.name === toolUse.name);

      try {
        log.debug('Executing tool', { name: toolUse.name, input: toolUse.input });
        const result = await this.executeTool(toolUse.name, toolUse.input as Record<string, unknown>);

        if (toolCall) {
          toolCall.status = 'completed';
          toolCall.result = result;
          if (this.settings.showToolCalls) {
            callbacks.onToolResult(assistantMsgId, toolCall.name, result);
          }
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Tool execution failed', error, { tool: toolUse.name });

        if (toolCall) {
          toolCall.status = 'error';
          toolCall.result = errorMessage;
          if (this.settings.showToolCalls) {
            callbacks.onToolResult(assistantMsgId, toolCall.name, errorMessage);
          }
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: errorMessage,
          is_error: true,
        });
      }
    }

    // Continue conversation with tool results
    const assistantBlocks: ContentBlockParam[] = [];
    if (assistantContent) {
      assistantBlocks.push({ type: 'text', text: assistantContent });
    }
    for (const toolUse of toolUseBlocks) {
      assistantBlocks.push({
        type: 'tool_use',
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input,
      });
    }

    messages.push({ role: 'assistant', content: assistantBlocks });
    messages.push({ role: 'user', content: toolResults });

    // Continue with same assistant message, passing accumulated state
    await this.processConversation(
      messages,
      assistantMsgId,
      callbacks,
      options,
      turnCount + 1,
      assistantContent,
      toolCalls
    );
  }

  /**
   * Convert conversation messages to Anthropic API format.
   */
  private convertToApiMessages(messages: ChatMessage[]): MessageParam[] {
    const result: MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue; // System is handled separately

      if (msg.role === 'user') {
        result.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const content: ContentBlockParam[] = [];

        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }

        // Include tool calls if present
        if (msg.toolCalls) {
          for (const tool of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: generateId(), // Generate ID for replay
              name: tool.name,
              input: tool.input,
            });
          }
        }

        if (content.length > 0) {
          result.push({ role: 'assistant', content });
        }
      }
    }

    return result;
  }

  /**
   * Get tool definitions in Anthropic API format.
   */
  private getToolDefinitions(): Tool[] {
    return this.obsidianTools.getToolDefinitions().map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Tool['input_schema'],
    }));
  }

  /**
   * Get tool names for session init callback.
   */
  private getToolNames(): string[] {
    return this.obsidianTools.getToolDefinitions().map(t => t.name);
  }

  /**
   * Execute a tool by name.
   */
  private async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    const toolDef = this.obsidianTools.getToolDefinitions().find(t => t.name === name);
    if (!toolDef) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return toolDef.handler(input);
  }

  /**
   * Get the full model ID.
   */
  private getModelId(override?: string): string {
    const model = override ?? this.settings.model;
    return MODEL_ID_MAP[model as keyof typeof MODEL_ID_MAP] ?? model;
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Generate a conversation title using Haiku for speed.
   */
  async generateTitle(firstUserMessage: string, firstAssistantMessage: string): Promise<string | null> {
    if (!this.initialized) {
      await this.initialize();
    }
    if (!this.client) return null;

    try {
      const response = await this.client.messages.create({
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
