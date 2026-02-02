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
import type { ModuleDeps } from '../../src/chatView/types';
import type { AgentBackend } from '../../src/backends';

// Mock logger
vi.mock('../../src/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('MessageOrchestrator', () => {
  let deps: ModuleDeps;
  let callbacks: MessageOrchestratorCallbacks;
  let handle: MessageOrchestratorHandle;
  let mockBackend: AgentBackend;

  beforeEach(() => {
    mockBackend = {
      type: 'sdk',
      isAvailable: vi.fn(() => true),
      initialize: vi.fn(),
      dispose: vi.fn(),
      sendMessage: vi.fn(),
      abort: vi.fn(),
      getSessionId: vi.fn(() => 'session-123'),
      supports: vi.fn(() => true),
      updateSettings: vi.fn(),
    };

    deps = {
      app: {} as ModuleDeps['app'],
      plugin: {} as ModuleDeps['plugin'],
    };

    callbacks = {
      getBackend: vi.fn(() => mockBackend),
      onProcessingChange: vi.fn(),
      onStatusChange: vi.fn(),
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
    });
  });

  describe('stop', () => {
    it('should abort the backend', () => {
      handle = createMessageOrchestrator(deps, callbacks);
      handle.stop();

      expect(mockBackend.abort).toHaveBeenCalled();
    });

    it('should set processing to false', () => {
      handle = createMessageOrchestrator(deps, callbacks);
      handle.stop();

      expect(callbacks.onProcessingChange).toHaveBeenCalledWith(false);
      expect(handle.isProcessing()).toBe(false);
    });

    it('should show stopped status', () => {
      handle = createMessageOrchestrator(deps, callbacks);
      handle.stop();

      expect(callbacks.onStatusChange).toHaveBeenCalledWith('Stopped', 'info');
    });
  });

  describe('isProcessing', () => {
    it('should return false initially', () => {
      handle = createMessageOrchestrator(deps, callbacks);
      expect(handle.isProcessing()).toBe(false);
    });

    it('should return false after stop', () => {
      handle = createMessageOrchestrator(deps, callbacks);
      handle.stop();
      expect(handle.isProcessing()).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should not throw when called', () => {
      handle = createMessageOrchestrator(deps, callbacks);
      expect(() => handle.destroy()).not.toThrow();
    });
  });

  describe('ContextInfo type', () => {
    it('should export ContextInfo interface for use by chatView', () => {
      // Type check - if this compiles, the interface is exported correctly
      const contextInfo: ContextInfo = {
        systemPrompt: 'You are helpful.',
      };
      expect(contextInfo.systemPrompt).toBe('You are helpful.');
    });

    it('should support selectedText in ContextInfo', () => {
      const contextInfo: ContextInfo = {
        systemPrompt: 'You are helpful.',
        selectedText: {
          path: 'test.md',
          startLine: 1,
          endLine: 5,
          text: 'Selected content',
        },
      };
      expect(contextInfo.selectedText?.path).toBe('test.md');
    });

    it('should support activeNote in ContextInfo', () => {
      const contextInfo: ContextInfo = {
        systemPrompt: 'You are helpful.',
        activeNote: {
          path: 'note.md',
          content: 'Note content',
          isDelta: false,
        },
      };
      expect(contextInfo.activeNote?.isDelta).toBe(false);
    });
  });
});
