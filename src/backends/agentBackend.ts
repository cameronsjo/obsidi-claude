import type { Conversation, ChatMessage, ToolCallInfo, ObsidiClaudeSettings } from '../types';
import { generateId } from '../types';

/**
 * Features that may or may not be supported by a backend
 */
export type BackendFeature =
  | 'session-resume'
  | 'mcp-servers'
  | 'hooks'
  | 'subagents'
  | 'file-checkpointing'
  | 'structured-output';

/**
 * Model information from the SDK
 */
export interface AvailableModel {
  /** Model identifier for API calls */
  value: string;
  /** Human-readable display name */
  displayName: string;
  /** Model description */
  description: string;
}

/**
 * Options for sending a message
 */
export interface BackendOptions {
  /** Resume from a previous session ID (SDK backend only) */
  resumeSessionId?: string;
  /** Override the default model */
  model?: string;
  /** Maximum conversation turns */
  maxTurns?: number;
  /** Custom system prompt */
  systemPrompt?: string;
  /** Content to display in UI (if different from API content, e.g., without context wrappers) */
  displayContent?: string;
}

/**
 * Result of a completed agent conversation
 */
export interface AgentResult {
  success: boolean;
  totalCost?: number;
  inputTokens?: number;
  outputTokens?: number;
  errors?: string[];
}

/**
 * Callbacks for streaming updates during message processing
 */
export interface AgentCallbacks {
  /** Called when a new message (user or assistant) is created */
  onMessage: (message: ChatMessage) => void;
  /** Called with incremental content updates during streaming */
  onStreamingUpdate: (messageId: string, content: string) => void;
  /** Called when a tool call is initiated */
  onToolCall: (messageId: string, toolCall: ToolCallInfo) => void;
  /** Called when a tool call completes with a result */
  onToolResult: (messageId: string, toolName: string, result: string) => void;
  /** Called when the session is initialized (SDK backend) */
  onSessionInit: (sessionId: string, tools: string[]) => void;
  /** Called when the conversation is complete */
  onComplete: (result: AgentResult) => void;
  /** Called when an error occurs */
  onError: (error: Error) => void;
}

/**
 * Abstract backend interface for Claude agent implementations.
 *
 * Two implementations:
 * - SDKAgentBackend: Desktop, uses Claude Agent SDK with full features
 * - APIAgentBackend: Mobile, uses direct Anthropic API with lighter footprint
 */
export interface AgentBackend {
  /** Unique identifier for this backend type */
  readonly type: 'sdk' | 'api';

  /** Check if the backend is available on this platform */
  isAvailable(): boolean;

  /** Initialize the backend (called once on activation) */
  initialize(): Promise<void>;

  /** Clean up resources */
  dispose(): Promise<void>;

  /**
   * Send a message and stream the response
   *
   * @param userMessage - The user's message content
   * @param conversation - Current conversation with history
   * @param callbacks - Streaming update callbacks
   * @param options - Additional options
   */
  sendMessage(
    userMessage: string,
    conversation: Conversation,
    callbacks: AgentCallbacks,
    options?: BackendOptions
  ): Promise<void>;

  /** Abort the current request */
  abort(): void;

  /** Get the current session ID (SDK backend only) */
  getSessionId(): string | null;

  /** Check if the backend supports a specific feature */
  supports(feature: BackendFeature): boolean;

  /** Update settings */
  updateSettings(settings: ObsidiClaudeSettings): void;

  /** Get available models (SDK backend only, may be null if not yet fetched) */
  getAvailableModels?(): AvailableModel[] | null;
}

/**
 * Factory functions for consistent message creation across backends
 */

export function createUserMessage(content: string): ChatMessage {
  return {
    id: generateId(),
    role: 'user',
    content,
    timestamp: Date.now(),
  };
}

export function createStreamingAssistantMessage(): ChatMessage {
  return {
    id: generateId(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isStreaming: true,
    toolCalls: [],
  };
}

/**
 * Append streaming text to the assistant message, handling paragraph breaks after tool results.
 */
export function appendStreamingText(
  text: string,
  context: {
    assistantContent: string;
    setAssistantContent: (content: string) => void;
    needsParagraphBreak: boolean;
    setNeedsParagraphBreak: (value: boolean) => void;
  },
  assistantMsgId: string,
  callbacks: { onStreamingUpdate: (id: string, content: string) => void }
): void {
  let processedText = text;
  if (context.needsParagraphBreak && processedText.trim()) {
    processedText = '\n\n' + processedText;
    context.setNeedsParagraphBreak(false);
  }
  const newContent = context.assistantContent + processedText;
  context.setAssistantContent(newContent);
  callbacks.onStreamingUpdate(assistantMsgId, newContent);
}
