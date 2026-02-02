/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createMessageOrchestrator,
  type MessageOrchestratorHandle,
  type MessageOrchestratorCallbacks,
  type ContextInfo,
} from '../../src/chatView/messageOrchestrator';
import type { ModuleDeps, Conversation, ChatMessage } from '../../src/chatView/types';
import type { AgentBackend, AgentCallbacks, AgentResult } from '../../src/backends';

// Mock Obsidian
vi.mock('obsidian', () => ({
  Notice: vi.fn(),
}));

// Mock logger
vi.mock('../../src/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock types
vi.mock('../../src/types', () => ({
  generateId: () => `test-${Math.random().toString(36).slice(2)}`,
  calculateCost: vi.fn(() => 0.001),
  calculateConversationUsage: vi.fn(() => ({
    totalInputTokens: 100,
    totalOutputTokens: 50,
    totalCost: 0.001,
    messageCount: 2,
  })),
}));

describe('MessageOrchestrator', () => {
  let deps: ModuleDeps;
  let callbacks: MessageOrchestratorCallbacks;
  let handle: MessageOrchestratorHandle;
  let mockBackend: AgentBackend;
  let mockConversation: Conversation;
  let capturedAgentCallbacks: AgentCallbacks | null;

  beforeEach(() => {
    capturedAgentCallbacks = null;

    mockConversation = {
      id: 'conv-1',
      title: 'Test Conversation',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    mockBackend = {
      type: 'sdk',
      isAvailable: vi.fn(() => true),
      initialize: vi.fn(),
      dispose: vi.fn(),
      sendMessage: vi.fn(async (_msg, _conv, cbs) => {
        capturedAgentCallbacks = cbs;
        // Simulate async completion
        await new Promise(resolve => setTimeout(resolve, 10));
      }),
      abort: vi.fn(),
      getSessionId: vi.fn(() => 'session-123'),
      supports: vi.fn(() => true),
      updateSettings: vi.fn(),
    };

    deps = {
      app: {
        vault: {
          trigger: vi.fn(),
        },
      } as unknown as ModuleDeps['app'],
      plugin: {
        settings: {
          model: 'claude-sonnet-4-20250514',
          systemPrompt: 'You are a helpful assistant.',
        },
      } as unknown as ModuleDeps['plugin'],
    };

    callbacks = {
      onMessageStart: vi.fn(),
      onMessageUpdate: vi.fn(),
      onMessageComplete: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onError: vi.fn(),
      onProcessingChange: vi.fn(),
      onStatusChange: vi.fn(),
      onSessionInit: vi.fn(),
      getBackend: vi.fn(() => mockBackend),
      getConversation: vi.fn(() => mockConversation),
      getContext: vi.fn(async () => ({
        systemPrompt: 'You are a helpful assistant.',
      })),
      saveConversation: vi.fn(),
      updateTokenCounter: vi.fn(),
      refreshStatusBar: vi.fn(),
      scrollToBottom: vi.fn(),
      getModel: vi.fn(() => 'claude-sonnet-4-20250514'),
    };
  });

  afterEach(() => {
    handle?.destroy();
    vi.clearAllMocks();
  });

  describe('creation', () => {
    it('should create orchestrator with initial state', () => {
      handle = createMessageOrchestrator(deps, callbacks);
      expect(handle).toBeDefined();
      expect(handle.isProcessing()).toBe(false);
      expect(handle.getQueueSize()).toBe(0);
    });
  });

  describe('send', () => {
    it('should send a message through the backend', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      await handle.send('Hello, Claude!');

      expect(mockBackend.sendMessage).toHaveBeenCalled();
      expect(callbacks.onProcessingChange).toHaveBeenCalledWith(true);
      expect(callbacks.onStatusChange).toHaveBeenCalledWith('Thinking...', 'info');
    });

    it('should not send empty messages', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      await handle.send('');

      expect(mockBackend.sendMessage).not.toHaveBeenCalled();
    });

    it('should queue messages when already processing', async () => {
      handle = createMessageOrchestrator(deps, callbacks);

      // Start first message
      const sendPromise = handle.send('First message');

      // Try to send second message while first is processing
      handle.send('Second message');

      expect(handle.getQueueSize()).toBe(1);

      await sendPromise;
    });

    it('should include context in message', async () => {
      const contextInfo: ContextInfo = {
        systemPrompt: 'You are helpful.',
        selectedText: {
          path: 'test.md',
          startLine: 1,
          endLine: 5,
          text: 'Selected content',
        },
      };

      (callbacks.getContext as ReturnType<typeof vi.fn>).mockResolvedValue(contextInfo);
      handle = createMessageOrchestrator(deps, callbacks);
      await handle.send('Question about this');

      expect(mockBackend.sendMessage).toHaveBeenCalled();
      const call = (mockBackend.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('<selected_text');
      expect(call[0]).toContain('Selected content');
    });

    it('should include active note delta in message', async () => {
      const contextInfo: ContextInfo = {
        systemPrompt: 'You are helpful.',
        activeNote: {
          path: 'note.md',
          content: '+ Added line',
          isDelta: true,
        },
      };

      (callbacks.getContext as ReturnType<typeof vi.fn>).mockResolvedValue(contextInfo);
      handle = createMessageOrchestrator(deps, callbacks);
      await handle.send('What changed?');

      const call = (mockBackend.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('<active_note_changes');
    });

    it('should update backend settings before sending', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      await handle.send('Hello');

      expect(mockBackend.updateSettings).toHaveBeenCalledWith(deps.plugin.settings);
    });
  });

  describe('agent callbacks', () => {
    it('should handle onMessage callback', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      await handle.send('Hello');

      expect(capturedAgentCallbacks).not.toBeNull();

      const mockMessage: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: 'Hi there!',
        timestamp: Date.now(),
      };

      capturedAgentCallbacks!.onMessage(mockMessage);

      expect(callbacks.onMessageStart).toHaveBeenCalledWith(mockMessage);
      expect(callbacks.updateTokenCounter).toHaveBeenCalled();
      expect(callbacks.scrollToBottom).toHaveBeenCalled();
      expect(mockConversation.messages).toContain(mockMessage);
    });

    it('should handle onStreamingUpdate callback', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      await handle.send('Hello');

      // Add a message first
      const mockMessage: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };
      mockConversation.messages.push(mockMessage);

      capturedAgentCallbacks!.onStreamingUpdate('msg-1', 'Updated content');

      expect(mockMessage.content).toBe('Updated content');
      expect(callbacks.onMessageUpdate).toHaveBeenCalledWith('msg-1', 'Updated content');
    });

    it('should handle onToolCall callback', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      await handle.send('Hello');

      const mockMessage: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };
      mockConversation.messages.push(mockMessage);

      const toolCall = {
        name: 'read_file',
        input: { path: 'test.md' },
        status: 'running' as const,
      };

      capturedAgentCallbacks!.onToolCall('msg-1', toolCall);

      expect(callbacks.onToolCall).toHaveBeenCalledWith('msg-1', expect.arrayContaining([toolCall]));
      expect(callbacks.onStatusChange).toHaveBeenCalledWith('Using tool: read_file', 'info');
    });

    it('should handle onToolResult callback', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      await handle.send('Hello');

      const mockMessage: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [{
          name: 'read_file',
          input: { path: 'test.md' },
          status: 'running' as const,
        }],
      };
      mockConversation.messages.push(mockMessage);

      // First trigger the tool call to populate internal state
      capturedAgentCallbacks!.onToolCall('msg-1', mockMessage.toolCalls![0]);

      // Then receive the result
      capturedAgentCallbacks!.onToolResult('msg-1', 'read_file', 'File contents here');

      expect(callbacks.onToolResult).toHaveBeenCalledWith('msg-1', 'read_file', 'File contents here');
    });

    it('should handle onComplete callback', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      await handle.send('Hello');

      const result: AgentResult = {
        success: true,
        inputTokens: 100,
        outputTokens: 50,
        totalCost: 0.001,
      };

      capturedAgentCallbacks!.onComplete(result);

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(callbacks.onProcessingChange).toHaveBeenCalledWith(false);
      expect(callbacks.refreshStatusBar).toHaveBeenCalled();
      expect(callbacks.saveConversation).toHaveBeenCalled();
    });

    it('should handle onError callback', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      await handle.send('Hello');

      const error = new Error('Something went wrong');
      capturedAgentCallbacks!.onError(error);

      expect(callbacks.onProcessingChange).toHaveBeenCalledWith(false);
      expect(callbacks.onError).toHaveBeenCalledWith(error);
      expect(callbacks.onStatusChange).toHaveBeenCalledWith(expect.stringContaining('Something went wrong'), 'error');
    });

    it('should handle session errors specially', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      mockConversation.metadata = { backendType: 'sdk', sessionId: 'old-session' };

      await handle.send('Hello');

      const error = new Error('Session exited with code 1');
      capturedAgentCallbacks!.onError(error);

      expect(mockConversation.metadata?.sessionId).toBeUndefined();
      expect(callbacks.onStatusChange).toHaveBeenCalledWith('Session error - try again', 'error');
    });

    it('should handle onSessionInit callback', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      await handle.send('Hello');

      capturedAgentCallbacks!.onSessionInit('new-session-id', ['tool1', 'tool2']);

      expect(mockConversation.metadata?.sessionId).toBe('new-session-id');
      expect(callbacks.onSessionInit).toHaveBeenCalledWith('new-session-id', ['tool1', 'tool2']);
    });
  });

  describe('stop', () => {
    it('should abort the backend and update state', async () => {
      handle = createMessageOrchestrator(deps, callbacks);

      // Start processing
      handle.send('Hello');
      expect(handle.isProcessing()).toBe(true);

      // Stop
      handle.stop();

      expect(mockBackend.abort).toHaveBeenCalled();
      expect(handle.isProcessing()).toBe(false);
      expect(callbacks.onStatusChange).toHaveBeenCalledWith('Stopped', 'info');
    });
  });

  describe('resume', () => {
    it('should set up resume metadata for SDK backend', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      mockConversation.metadata = { backendType: 'sdk', sessionId: 'session-123' };
      mockConversation.messages = [
        { id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() },
        { id: 'msg-2', role: 'assistant', content: 'Hi', timestamp: Date.now(), sdkUuid: 'uuid-123' },
        { id: 'msg-3', role: 'user', content: 'More', timestamp: Date.now() },
      ];

      await handle.resume('msg-2');

      expect(mockConversation.metadata?.resumeAtUuid).toBe('uuid-123');
      expect(mockConversation.metadata?.forkFromSessionId).toBe('session-123');
      expect(mockConversation.messages).toHaveLength(2);
      expect(callbacks.saveConversation).toHaveBeenCalled();
    });

    it('should fail if message has no SDK UUID', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      mockConversation.messages = [
        { id: 'msg-1', role: 'assistant', content: 'Hi', timestamp: Date.now() },
      ];

      await handle.resume('msg-1');

      expect(callbacks.onStatusChange).toHaveBeenCalledWith('Cannot resume: message has no SDK UUID', 'error');
    });

    it('should fail if no session ID exists', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      mockConversation.messages = [
        { id: 'msg-1', role: 'assistant', content: 'Hi', timestamp: Date.now(), sdkUuid: 'uuid-123' },
      ];

      await handle.resume('msg-1');

      expect(callbacks.onStatusChange).toHaveBeenCalledWith('Cannot resume: no session ID', 'error');
    });
  });

  describe('queue', () => {
    it('should add messages to queue', () => {
      handle = createMessageOrchestrator(deps, callbacks);
      handle.addToQueue('Message 1');
      handle.addToQueue('Message 2');

      expect(handle.getQueueSize()).toBe(2);
    });

    it('should clear the queue', () => {
      handle = createMessageOrchestrator(deps, callbacks);
      handle.addToQueue('Message 1');
      handle.addToQueue('Message 2');
      handle.clearQueue();

      expect(handle.getQueueSize()).toBe(0);
    });

    it('should process next in queue when not busy', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      handle.addToQueue('Queued message');

      await handle.processNextInQueue();

      expect(mockBackend.sendMessage).toHaveBeenCalled();
      expect(handle.getQueueSize()).toBe(0);
    });

    it('should not process queue when already processing', async () => {
      // Use a long-running mock that doesn't resolve quickly
      let sendResolve: (() => void) | null = null;
      (mockBackend.sendMessage as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        return new Promise<void>(resolve => {
          sendResolve = resolve;
        });
      });

      handle = createMessageOrchestrator(deps, callbacks);

      // Start processing (don't await - let it run)
      const sendPromise = handle.send('Current message');

      // Wait a tick for processing flag to be set
      await new Promise(resolve => setTimeout(resolve, 0));

      // Now add to queue while processing
      handle.addToQueue('Queued message');
      expect(handle.isProcessing()).toBe(true);

      // Try to process queue while busy - should be blocked
      await handle.processNextInQueue();

      // Should not have called send again yet
      expect(mockBackend.sendMessage).toHaveBeenCalledTimes(1);
      expect(handle.getQueueSize()).toBe(1);

      // Clean up: resolve the pending send
      sendResolve?.();
      await sendPromise;
    });

    it('should auto-process queue after completion', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      handle.addToQueue('Queued message');

      await handle.send('First message');

      // Simulate completion
      const result: AgentResult = { success: true };
      capturedAgentCallbacks!.onComplete(result);

      // Wait for the setTimeout in onComplete
      await new Promise(resolve => setTimeout(resolve, 600));

      // Queue should be processed
      expect(mockBackend.sendMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('model change handling', () => {
    it('should clear session when model changes', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      mockConversation.metadata = {
        backendType: 'sdk',
        sessionId: 'old-session',
        model: 'claude-3-haiku',
      };

      await handle.send('Hello');

      expect(mockConversation.metadata?.sessionId).toBeUndefined();
      expect(callbacks.onStatusChange).toHaveBeenCalledWith(
        expect.stringContaining('Switched to'),
        'info'
      );
    });

    it('should not clear session when model is the same', async () => {
      handle = createMessageOrchestrator(deps, callbacks);
      mockConversation.metadata = {
        backendType: 'sdk',
        sessionId: 'existing-session',
        model: 'claude-sonnet-4-20250514',
      };

      await handle.send('Hello');

      // Session should be preserved (not explicitly cleared)
      // Note: it may get updated by onSessionInit, but shouldn't be cleared
      expect(callbacks.onStatusChange).not.toHaveBeenCalledWith(
        expect.stringContaining('Switched to'),
        'info'
      );
    });
  });

  describe('destroy', () => {
    it('should clean up resources', () => {
      handle = createMessageOrchestrator(deps, callbacks);
      handle.addToQueue('Message');

      handle.destroy();

      expect(handle.getQueueSize()).toBe(0);
    });
  });
});
