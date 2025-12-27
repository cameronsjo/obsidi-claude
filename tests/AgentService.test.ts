import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentService, type AgentCallbacks } from '../src/AgentService';
import { DEFAULT_SETTINGS } from '../src/types';

// Mock the claude-agent-sdk
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

// Mock the claudePath module
vi.mock('../src/claudePath', () => ({
  findClaudeCliPath: vi.fn(() => '/usr/local/bin/claude'),
  getEnhancedPath: vi.fn(() => '/usr/local/bin:/usr/bin'),
}));

// Mock the Logger
vi.mock('../src/Logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';

describe('AgentService', () => {
  let agentService: AgentService;
  let mockCallbacks: AgentCallbacks;

  beforeEach(() => {
    vi.clearAllMocks();

    const settings = {
      ...DEFAULT_SETTINGS,
      workingDirectory: '/test/vault',
      claudeCodePath: '/usr/local/bin/claude',
    };
    agentService = new AgentService(settings);

    mockCallbacks = {
      onMessage: vi.fn(),
      onStreamingUpdate: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onSessionInit: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };
  });

  describe('constructor', () => {
    it('should create instance with settings', () => {
      expect(agentService).toBeDefined();
    });
  });

  describe('updateSettings', () => {
    it('should update settings', () => {
      const newSettings = {
        ...DEFAULT_SETTINGS,
        workingDirectory: '/new/path',
        model: 'claude-opus-4' as const,
      };
      agentService.updateSettings(newSettings);
      // Settings are private, but we can verify via behavior
      expect(agentService).toBeDefined();
    });
  });

  describe('getSessionId', () => {
    it('should return null initially', () => {
      expect(agentService.getSessionId()).toBeNull();
    });
  });

  describe('sendMessage', () => {
    it('should throw error when workingDirectory is not set', async () => {
      const emptySettings = {
        ...DEFAULT_SETTINGS,
        workingDirectory: '',
        claudeCodePath: '/usr/local/bin/claude',
      };
      const service = new AgentService(emptySettings);

      await service.sendMessage('Hello', [], mockCallbacks);

      expect(mockCallbacks.onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Working directory not configured'),
        })
      );
    });

    it('should throw error when Claude CLI is not found', async () => {
      // Mock findClaudeCliPath to return null (CLI not found)
      const { findClaudeCliPath } = await import('../src/claudePath');
      vi.mocked(findClaudeCliPath).mockReturnValueOnce(null);

      const emptySettings = {
        ...DEFAULT_SETTINGS,
        workingDirectory: '/test/vault',
        claudeCodePath: '',
      };
      const service = new AgentService(emptySettings);

      await service.sendMessage('Hello', [], mockCallbacks);

      expect(mockCallbacks.onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Claude Code CLI not found'),
        })
      );
    });

    it('should create user message', async () => {
      // Mock query to return an async generator
      const mockQuery = vi.mocked(query);
      mockQuery.mockReturnValue(
        (async function* () {
          yield {
            type: 'result',
            subtype: 'success',
          };
        })()
      );

      await agentService.sendMessage('Hello', [], mockCallbacks);

      expect(mockCallbacks.onMessage).toHaveBeenCalledTimes(2); // user + assistant
      expect(mockCallbacks.onMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'user',
          content: 'Hello',
        })
      );
    });

    it('should create streaming assistant message', async () => {
      const mockQuery = vi.mocked(query);
      mockQuery.mockReturnValue(
        (async function* () {
          yield {
            type: 'result',
            subtype: 'success',
          };
        })()
      );

      await agentService.sendMessage('Hello', [], mockCallbacks);

      expect(mockCallbacks.onMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          isStreaming: true,
        })
      );
    });

    it('should handle session init message', async () => {
      const mockQuery = vi.mocked(query);
      mockQuery.mockReturnValue(
        (async function* () {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'test-session-123',
            tools: ['Read', 'Write'],
          };
          yield {
            type: 'result',
            subtype: 'success',
          };
        })()
      );

      await agentService.sendMessage('Hello', [], mockCallbacks);

      expect(mockCallbacks.onSessionInit).toHaveBeenCalledWith(
        'test-session-123',
        ['Read', 'Write']
      );
      expect(agentService.getSessionId()).toBe('test-session-123');
    });

    it('should handle assistant text content', async () => {
      const mockQuery = vi.mocked(query);
      mockQuery.mockReturnValue(
        (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Hello there!' }],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
          };
        })()
      );

      await agentService.sendMessage('Hello', [], mockCallbacks);

      expect(mockCallbacks.onStreamingUpdate).toHaveBeenCalledWith(
        expect.any(String),
        'Hello there!'
      );
    });

    it('should handle tool use blocks', async () => {
      const mockQuery = vi.mocked(query);
      const settings = { ...DEFAULT_SETTINGS, workingDirectory: '/test', claudeCodePath: '/usr/local/bin/claude', showToolCalls: true };
      const service = new AgentService(settings);

      mockQuery.mockReturnValue(
        (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'tool-123',
                  name: 'Read',
                  input: { path: '/test.md' },
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
          };
        })()
      );

      await service.sendMessage('Read file', [], mockCallbacks);

      expect(mockCallbacks.onToolCall).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          name: 'Read',
          status: 'pending',
        })
      );
    });

    it('should handle completion with success', async () => {
      const mockQuery = vi.mocked(query);
      mockQuery.mockReturnValue(
        (async function* () {
          yield {
            type: 'result',
            subtype: 'success',
            total_cost_usd: 0.001,
            usage: {
              input_tokens: 100,
              output_tokens: 50,
            },
          };
        })()
      );

      await agentService.sendMessage('Hello', [], mockCallbacks);

      expect(mockCallbacks.onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          totalCost: 0.001,
          inputTokens: 100,
          outputTokens: 50,
        })
      );
    });

    it('should handle completion with error', async () => {
      const mockQuery = vi.mocked(query);
      mockQuery.mockReturnValue(
        (async function* () {
          yield {
            type: 'result',
            subtype: 'error',
            errors: ['Something went wrong'],
          };
        })()
      );

      await agentService.sendMessage('Hello', [], mockCallbacks);

      expect(mockCallbacks.onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errors: ['Something went wrong'],
        })
      );
    });

    it('should pass resume session ID to options', async () => {
      const mockQuery = vi.mocked(query);
      mockQuery.mockReturnValue(
        (async function* () {
          yield { type: 'result', subtype: 'success' };
        })()
      );

      await agentService.sendMessage('Hello', [], mockCallbacks, 'session-to-resume');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            resume: 'session-to-resume',
          }),
        })
      );
    });
  });

  describe('abort', () => {
    it('should abort in-flight request', async () => {
      const mockQuery = vi.mocked(query);
      let abortController: AbortController | undefined;

      mockQuery.mockImplementation(({ options }) => {
        abortController = options.abortController;
        return (async function* () {
          // Simulate a long-running operation
          await new Promise((resolve) => setTimeout(resolve, 100));
          yield { type: 'result', subtype: 'success' };
        })();
      });

      // Start sending (don't await)
      const sendPromise = agentService.sendMessage('Hello', [], mockCallbacks);

      // Abort after a short delay
      await new Promise((resolve) => setTimeout(resolve, 10));
      agentService.abort();

      await sendPromise;

      expect(abortController?.signal.aborted).toBe(true);
    });
  });

  describe('resumeSession', () => {
    it('should call sendMessage with session ID', async () => {
      const mockQuery = vi.mocked(query);
      mockQuery.mockReturnValue(
        (async function* () {
          yield { type: 'result', subtype: 'success' };
        })()
      );

      await agentService.resumeSession('session-123', 'Continue', mockCallbacks);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            resume: 'session-123',
          }),
        })
      );
    });
  });
});

describe('AgentService message handling edge cases', () => {
  let agentService: AgentService;
  let mockCallbacks: AgentCallbacks;

  beforeEach(() => {
    vi.clearAllMocks();
    const settings = { ...DEFAULT_SETTINGS, workingDirectory: '/test', claudeCodePath: '/usr/local/bin/claude' };
    agentService = new AgentService(settings);

    mockCallbacks = {
      onMessage: vi.fn(),
      onStreamingUpdate: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onSessionInit: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };
  });

  it('should handle stream_event for text delta', async () => {
    const mockQuery = vi.mocked(query);
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: {
              type: 'text_delta',
              text: 'Streaming ',
            },
          },
        };
        yield {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: {
              type: 'text_delta',
              text: 'text',
            },
          },
        };
        yield { type: 'result', subtype: 'success' };
      })()
    );

    await agentService.sendMessage('Hello', [], mockCallbacks);

    // Final update should contain accumulated text
    const streamingCalls = vi.mocked(mockCallbacks.onStreamingUpdate).mock.calls;
    expect(streamingCalls.length).toBeGreaterThan(0);
    const lastCall = streamingCalls[streamingCalls.length - 1];
    expect(lastCall[1]).toContain('Streaming text');
  });

  it('should handle query throwing an error', async () => {
    const mockQuery = vi.mocked(query);
    mockQuery.mockImplementation(() => {
      throw new Error('Network error');
    });

    await agentService.sendMessage('Hello', [], mockCallbacks);

    expect(mockCallbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Network error',
      })
    );
  });
});
