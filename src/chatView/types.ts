/**
 * Shared types for ChatView modules.
 */
import type { App } from 'obsidian';
import type ObsidiClaudePlugin from '../../main';
import type {
  ChatMessage,
  Conversation,
  ToolCallInfo,
  ImageAttachment,
  MessageReaction,
  ChatTab,
  ConversationUsage,
} from '../types';

// Re-export for convenience
export type {
  ChatMessage,
  Conversation,
  ToolCallInfo,
  ImageAttachment,
  MessageReaction,
  ChatTab,
  ConversationUsage,
};

/**
 * Conversation metadata for history list display.
 */
export interface ConversationMeta {
  id: string;
  title: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  pinned?: boolean;
  preview?: string;
}

/**
 * Common dependencies passed to all modules.
 */
export interface ModuleDeps {
  app: App;
  plugin: ObsidiClaudePlugin;
}

/**
 * Base handle interface for all UI modules.
 */
export interface ModuleHandle {
  destroy(): void;
}
