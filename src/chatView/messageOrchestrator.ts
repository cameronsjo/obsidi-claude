/**
 * Message orchestrator module for ChatView.
 * Handles stop functionality for message generation.
 */
import type { ModuleDeps, ModuleHandle } from './types';
import type { AgentBackend } from '../backends';
import { createLogger } from '../logger';

const log = createLogger('MessageOrchestrator');

/**
 * Information for context injection.
 * Used by chatView.ts for building context.
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
 * Callbacks for message orchestrator.
 */
export interface MessageOrchestratorCallbacks {
  /** Get the current agent backend */
  getBackend: () => AgentBackend;
  /** Called when processing state changes */
  onProcessingChange: (processing: boolean) => void;
  /** Called when status message should be updated */
  onStatusChange: (message: string, type: 'info' | 'error' | 'success') => void;
}

/**
 * Handle for controlling message orchestration.
 */
export interface MessageOrchestratorHandle extends ModuleHandle {
  /** Stop current generation */
  stop(): void;
  /** Check if currently processing */
  isProcessing(): boolean;
}

/**
 * Create a message orchestrator.
 * @param _deps - Module dependencies (reserved for future use)
 * @param callbacks - Callbacks for parent communication
 */
export function createMessageOrchestrator(
  _deps: ModuleDeps,
  callbacks: MessageOrchestratorCallbacks
): MessageOrchestratorHandle {
  let processing = false;

  function setProcessing(value: boolean): void {
    processing = value;
    callbacks.onProcessingChange(value);
  }

  function stop(): void {
    log.info('User stopped generation');
    callbacks.getBackend().abort();
    setProcessing(false);
    callbacks.onStatusChange('Stopped', 'info');
  }

  function destroy(): void {
    // No resources to clean up
  }

  return {
    stop,
    isProcessing: () => processing,
    destroy,
  };
}
