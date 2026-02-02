/**
 * Message orchestrator module for ChatView.
 * Handles message sending, response streaming, tool calls, and stop/resume functionality.
 */
import { Notice } from 'obsidian';
import type { ModuleDeps, ModuleHandle, ChatMessage, Conversation, ToolCallInfo, ImageAttachment } from './types';
import type { AgentBackend, AgentCallbacks, BackendOptions } from '../backends';
import { generateId, calculateCost, calculateConversationUsage } from '../types';
import { createLogger } from '../logger';

const log = createLogger('MessageOrchestrator');

/**
 * Information for context injection.
 */
export interface ContextInfo {
  /** System prompt to use */
  systemPrompt: string;
  /** Optional selected text from editor */
  selectedText?: {
    path: string;
    startLine: number;
    endLine: number;
    text: string;
  };
  /** Optional active note for context */
  activeNote?: {
    path: string;
    content: string;
    isDelta: boolean;
  };
}

/**
 * Callbacks for message orchestrator to communicate with parent.
 */
export interface MessageOrchestratorCallbacks {
  /** Called when a new message is added to the conversation */
  onMessageStart: (msg: ChatMessage) => void;
  /** Called when message content is updated during streaming */
  onMessageUpdate: (id: string, content: string) => void;
  /** Called when a message is complete */
  onMessageComplete: (id: string) => void;
  /** Called when a tool call is made or updated */
  onToolCall: (id: string, tools: ToolCallInfo[]) => void;
  /** Called when a tool result is received */
  onToolResult: (id: string, toolName: string, result: string) => void;
  /** Called when an error occurs */
  onError: (error: Error) => void;
  /** Called when processing state changes */
  onProcessingChange: (processing: boolean) => void;
  /** Called when status message should be updated */
  onStatusChange: (message: string, type: 'info' | 'error' | 'success') => void;
  /** Called when session is initialized */
  onSessionInit: (sessionId: string, tools: string[]) => void;
  /** Called when SDK UUID is available for a message */
  onSdkUuid?: (messageId: string, uuid: string) => void;
  /** Called when tool summary is available */
  onToolSummary?: (messageId: string, summary: string) => void;
  /** Called when files are persisted by Claude */
  onFilesPersisted?: (filenames: string[]) => void;
  /** Called when a background task notification arrives */
  onTaskNotification?: (taskId: string, status: 'completed' | 'failed' | 'stopped', summary: string, outputFile: string, assistantMsgId: string | null) => void;
  /** Called when context compaction status changes */
  onCompactionStatus?: (status: 'compacting' | null) => void;
  /** Called when compaction boundary is recorded */
  onCompactionBoundary?: (trigger: 'manual' | 'auto', preTokens: number) => void;
  /** Get the current agent backend */
  getBackend: () => AgentBackend;
  /** Get the current conversation */
  getConversation: () => Conversation;
  /** Get context info for message injection */
  getContext: () => Promise<ContextInfo>;
  /** Save the conversation */
  saveConversation: () => Promise<void>;
  /** Update token counter display */
  updateTokenCounter: () => void;
  /** Refresh status bar */
  refreshStatusBar: () => void;
  /** Scroll to bottom of messages */
  scrollToBottom: () => void;
  /** Get model from settings */
  getModel: () => string;
}

/**
 * Handle for controlling message orchestration.
 */
export interface MessageOrchestratorHandle extends ModuleHandle {
  /** Send a message */
  send(content: string, images?: ImageAttachment[]): Promise<void>;
  /** Stop current generation */
  stop(): void;
  /** Resume from a specific message checkpoint */
  resume(messageId: string): Promise<void>;
  /** Check if currently processing */
  isProcessing(): boolean;
  /** Add message to queue */
  addToQueue(content: string): void;
  /** Process next message in queue */
  processNextInQueue(): Promise<void>;
  /** Clear the message queue */
  clearQueue(): void;
  /** Get queue size */
  getQueueSize(): number;
}

interface QueuedMessage {
  content: string;
  timestamp: number;
  images?: ImageAttachment[];
}

/**
 * Create a message orchestrator.
 * @param deps - Module dependencies
 * @param callbacks - Callbacks for parent communication
 */
export function createMessageOrchestrator(
  deps: ModuleDeps,
  callbacks: MessageOrchestratorCallbacks
): MessageOrchestratorHandle {
  // Internal state
  let processing = false;
  const messageQueue: QueuedMessage[] = [];
  let currentAssistantMsgId: string | null = null;
  let currentToolCalls: ToolCallInfo[] = [];
  let vaultRefreshTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Build the AgentCallbacks object for backend communication.
   */
  function buildAgentCallbacks(): AgentCallbacks {
    const conversation = callbacks.getConversation();
    const backend = callbacks.getBackend();

    return {
      onMessage: (msg) => {
        conversation.messages.push(msg);
        callbacks.onMessageStart(msg);
        callbacks.updateTokenCounter();

        if (msg.role === 'assistant') {
          currentAssistantMsgId = msg.id;
        }

        callbacks.scrollToBottom();
      },

      onStreamingUpdate: (messageId, content) => {
        const msg = conversation.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.content = content;
          msg.isStreaming = false;
        }
        callbacks.onMessageUpdate(messageId, content);
      },

      onToolCall: (messageId, toolCall) => {
        const existing = currentToolCalls.find((t) => t.name === toolCall.name);
        if (existing) {
          Object.assign(existing, toolCall);
        } else {
          currentToolCalls.push(toolCall);
        }

        const msg = conversation.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.toolCalls = [...currentToolCalls];
        }

        callbacks.onToolCall(messageId, currentToolCalls);
        callbacks.onStatusChange(`Using tool: ${toolCall.name}`, 'info');
      },

      onToolResult: (messageId, toolName, result) => {
        const tool = currentToolCalls.find((t) => t.name === toolName);
        if (tool) {
          tool.result = result;
          tool.status = 'completed';
        }

        const msg = conversation.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.toolCalls = [...currentToolCalls];
        }

        callbacks.onToolResult(messageId, toolName, result);
      },

      onSessionInit: (sessionId, tools) => {
        if (!conversation.metadata) {
          conversation.metadata = { backendType: backend.type };
        }
        conversation.metadata.sessionId = sessionId;
        conversation.sessionId = sessionId; // Legacy support
        log.info('Session initialized', { sessionId, toolCount: tools.length, backendType: backend.type });
        log.debug('Available tools', { tools });
        callbacks.onSessionInit(sessionId, tools);
      },

      onComplete: async (result) => {
        setProcessing(false);
        callbacks.refreshStatusBar();

        // Capture usage data on the assistant message
        if (currentAssistantMsgId && (result.inputTokens || result.outputTokens)) {
          const msg = conversation.messages.find((m) => m.id === currentAssistantMsgId);
          if (msg) {
            const inputTokens = result.inputTokens ?? 0;
            const outputTokens = result.outputTokens ?? 0;
            const cost = result.totalCost ?? calculateCost(
              inputTokens,
              outputTokens,
              callbacks.getModel()
            );
            msg.usage = { inputTokens, outputTokens, cost };
          }

          // Update conversation-level usage stats
          conversation.usage = calculateConversationUsage(conversation.messages);
        }

        if (result.success) {
          callbacks.onStatusChange('', 'info');
          callbacks.updateTokenCounter();
        } else {
          callbacks.onStatusChange(
            `Errors: ${result.errors?.join(', ') || 'Unknown error'}`,
            'error'
          );
        }

        // Save conversation
        conversation.updatedAt = Date.now();
        await callbacks.saveConversation();

        // Mark message complete
        if (currentAssistantMsgId) {
          callbacks.onMessageComplete(currentAssistantMsgId);
        }

        // Process next message in queue if any
        if (messageQueue.length > 0) {
          setTimeout(() => processNextInQueue(), 500);
        }
      },

      onError: (error) => {
        setProcessing(false);
        log.error('Agent error during message processing', error);

        // Clean up error message - first line only, no stack traces
        const fullMsg = error.message || 'Unknown error';
        const firstLine = fullMsg.split('\n')[0].trim();
        const cleanMsg = firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine;

        // Check for session/model mismatch errors
        if (fullMsg.toLowerCase().includes('exited with code') || fullMsg.toLowerCase().includes('session')) {
          // Clear session and offer to retry
          delete conversation.metadata?.sessionId;
          delete conversation.sessionId;
          callbacks.onStatusChange('Session error - try again', 'error');
          new Notice('Session ended. Please try again.', 3000);
        } else {
          callbacks.onStatusChange(cleanMsg, 'error');
        }

        callbacks.onError(error);
      },

      onSdkUuid: (messageId, uuid) => {
        const msg = conversation.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.sdkUuid = uuid;
          log.debug('Stored SDK UUID for message', { messageId, uuid });
        }
        callbacks.onSdkUuid?.(messageId, uuid);
      },

      onToolSummary: (messageId, summary) => {
        const msg = conversation.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.toolSummary = summary;
          log.debug('Received tool summary', { messageId, summary });
        }
        callbacks.onToolSummary?.(messageId, summary);
      },

      onFilesPersisted: (filenames) => {
        log.info('Files modified by Claude, refreshing vault', { count: filenames.length });

        // Schedule a vault refresh (debounced to avoid rapid refreshes)
        if (vaultRefreshTimeout) {
          clearTimeout(vaultRefreshTimeout);
        }
        vaultRefreshTimeout = setTimeout(() => {
          deps.plugin.app.vault.trigger('modify');
          log.debug('Vault refresh triggered');
        }, 500);

        callbacks.onFilesPersisted?.(filenames);
      },

      onTaskNotification: (taskId, status, summary, outputFile) => {
        log.info('Background task notification', { taskId, status, summary });
        callbacks.onTaskNotification?.(taskId, status, summary, outputFile, currentAssistantMsgId);
      },

      onCompactionStatus: (status) => {
        if (status === 'compacting') {
          callbacks.onStatusChange('Compacting context...', 'info');
          log.info('Context compaction started');
        } else {
          callbacks.onStatusChange('', 'info');
          log.info('Context compaction completed');
        }
        callbacks.onCompactionStatus?.(status);
      },

      onCompactionBoundary: (trigger, preTokens) => {
        const tokensK = Math.round(preTokens / 1000);
        log.info('Context compacted', { trigger, preTokens, tokensK });

        new Notice(`Context compacted: was ~${tokensK}K tokens (${trigger})`, 3000);

        const conversation = callbacks.getConversation();
        if (!conversation.metadata) {
          conversation.metadata = { backendType: 'sdk' };
        }
        if (!conversation.metadata.compactions) {
          conversation.metadata.compactions = [];
        }
        conversation.metadata.compactions.push({
          timestamp: Date.now(),
          trigger,
          preTokens,
        });
        callbacks.saveConversation();
        callbacks.onCompactionBoundary?.(trigger, preTokens);
      },

      onStructuredOutput: () => {
        // Handled by specific commands that use structured output
      },
    };
  }

  /**
   * Set processing state and notify parent.
   */
  function setProcessing(value: boolean): void {
    processing = value;
    callbacks.onProcessingChange(value);
  }

  /**
   * Build the message content with optional context injection.
   */
  async function buildMessageContent(content: string): Promise<{ messageContent: string; displayContent?: string }> {
    const contextInfo = await callbacks.getContext();
    let messageContent = content;
    let displayContent: string | undefined;

    // Check for selected text first - this takes priority
    if (contextInfo.selectedText) {
      const { path, startLine, endLine, text } = contextInfo.selectedText;
      messageContent = `<selected_text path="${path}" lines="${startLine}-${endLine}">\n${text}\n</selected_text>\n\n${content}`;
      displayContent = content;
      log.debug('Included selected text', { path, lines: `${startLine}-${endLine}`, length: text.length });
    } else if (contextInfo.activeNote) {
      // No selection - use full note or delta
      const { path, content: noteContent, isDelta } = contextInfo.activeNote;
      if (isDelta) {
        messageContent = `<active_note_changes path="${path}">\n${noteContent}\n</active_note_changes>\n\n${content}`;
        log.debug('Included note delta', { path, deltaLength: noteContent.length });
      } else {
        messageContent = `<active_note path="${path}">\n${noteContent}\n</active_note>\n\n${content}`;
        log.debug('Included active note context', { path, contentLength: noteContent.length });
      }
      displayContent = content;
    }

    return { messageContent, displayContent };
  }

  /**
   * Send a message through the backend.
   */
  async function send(content: string, images?: ImageAttachment[]): Promise<void> {
    if (!content) return;

    // If already processing, add to queue
    if (processing) {
      addToQueue(content, images);
      return;
    }

    log.info('User sending message', { contentLength: content.length });

    // Reset state for new message
    currentAssistantMsgId = null;
    currentToolCalls = [];

    setProcessing(true);
    callbacks.onStatusChange('Thinking...', 'info');

    const backend = callbacks.getBackend();
    const conversation = callbacks.getConversation();

    // Update backend settings
    backend.updateSettings(deps.plugin.settings);

    // Check if model changed - if so, clear session to start fresh
    const currentModel = callbacks.getModel();
    const sessionModel = conversation.metadata?.model;
    if (sessionModel && sessionModel !== currentModel) {
      log.info('Model changed, starting fresh session', { from: sessionModel, to: currentModel });
      delete conversation.metadata?.sessionId;
      delete conversation.sessionId;
      callbacks.onStatusChange(`Switched to ${currentModel}`, 'info');
    }

    // Track the model used for this conversation
    if (!conversation.metadata) {
      conversation.metadata = { backendType: backend.type };
    }
    (conversation.metadata as Record<string, unknown>).model = currentModel;

    const agentCallbacks = buildAgentCallbacks();

    try {
      // Build message with context injection
      const contextInfo = await callbacks.getContext();
      const { messageContent, displayContent } = await buildMessageContent(content);

      // Prepare backend options
      const forkFromSessionId = conversation.metadata?.forkFromSessionId;
      const resumeAtUuid = conversation.metadata?.resumeAtUuid;
      const resumeSessionId = forkFromSessionId || conversation.metadata?.sessionId || conversation.sessionId;

      const options: BackendOptions = {
        resumeSessionId,
        forkSession: !!forkFromSessionId,
        resumeSessionAt: resumeAtUuid,
        systemPrompt: contextInfo.systemPrompt,
        displayContent,
        images,
      };

      await backend.sendMessage(messageContent, conversation, agentCallbacks, options);

      // Clear the fork/resume flags after use (one-time)
      if ((forkFromSessionId || resumeAtUuid) && conversation.metadata) {
        delete conversation.metadata.forkFromSessionId;
        delete conversation.metadata.resumeAtUuid;
        await callbacks.saveConversation();
      }
    } catch (error) {
      agentCallbacks.onError(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Stop the current generation.
   */
  function stop(): void {
    log.info('User stopped generation');
    callbacks.getBackend().abort();
    setProcessing(false);
    callbacks.onStatusChange('Stopped', 'info');
  }

  /**
   * Resume from a specific message checkpoint.
   */
  async function resume(messageId: string): Promise<void> {
    const conversation = callbacks.getConversation();
    const msg = conversation.messages.find((m) => m.id === messageId);

    if (!msg?.sdkUuid) {
      callbacks.onStatusChange('Cannot resume: message has no SDK UUID', 'error');
      return;
    }

    const sessionId = conversation.metadata?.sessionId;
    if (!sessionId) {
      callbacks.onStatusChange('Cannot resume: no session ID', 'error');
      return;
    }

    // Set up the fork metadata for the next message
    if (!conversation.metadata) {
      conversation.metadata = { backendType: 'sdk' };
    }
    conversation.metadata.resumeAtUuid = msg.sdkUuid;
    conversation.metadata.forkFromSessionId = sessionId;

    // Trim messages to only include up to the selected message
    const msgIndex = conversation.messages.findIndex((m) => m.id === messageId);
    if (msgIndex >= 0) {
      conversation.messages = conversation.messages.slice(0, msgIndex + 1);
    }

    await callbacks.saveConversation();
    callbacks.onStatusChange('Ready to resume from checkpoint', 'success');
    log.info('Set up resume from checkpoint', { messageId, uuid: msg.sdkUuid });
  }

  /**
   * Add a message to the queue.
   */
  function addToQueue(content: string, images?: ImageAttachment[]): void {
    messageQueue.push({ content, timestamp: Date.now(), images });
    log.debug('Message added to queue', { queueLength: messageQueue.length });
  }

  /**
   * Process the next message in the queue.
   */
  async function processNextInQueue(): Promise<void> {
    if (processing) return;

    const nextMessage = messageQueue.shift();
    if (!nextMessage) return;

    log.info('Processing next message from queue');
    await send(nextMessage.content, nextMessage.images);
  }

  /**
   * Clear the message queue.
   */
  function clearQueue(): void {
    messageQueue.length = 0;
    log.debug('Queue cleared');
  }

  /**
   * Clean up resources.
   */
  function destroy(): void {
    if (vaultRefreshTimeout) {
      clearTimeout(vaultRefreshTimeout);
    }
    messageQueue.length = 0;
  }

  return {
    send,
    stop,
    resume,
    isProcessing: () => processing,
    addToQueue: (content) => addToQueue(content),
    processNextInQueue,
    clearQueue,
    getQueueSize: () => messageQueue.length,
    destroy,
  };
}
