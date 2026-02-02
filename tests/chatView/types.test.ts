import { describe, it, expect } from 'vitest';
import type {
  ModuleDeps,
  ModuleHandle,
  ConversationMeta,
} from '../../src/chatView/types';

describe('ChatView module types', () => {
  it('should define ModuleDeps interface with required properties', () => {
    // Type-level test - if this compiles, types are correct
    const deps: ModuleDeps = {
      app: {} as any,
      plugin: {} as any,
    };
    expect(deps).toBeDefined();
  });

  it('should define ModuleHandle with destroy method', () => {
    const handle: ModuleHandle = {
      destroy: () => {},
    };
    expect(typeof handle.destroy).toBe('function');
  });

  it('should define ConversationMeta with required fields', () => {
    const meta: ConversationMeta = {
      id: 'test-id',
      title: 'Test Conversation',
      messageCount: 5,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(meta.id).toBe('test-id');
    expect(meta.title).toBe('Test Conversation');
    expect(meta.messageCount).toBe(5);
  });

  it('should allow optional fields on ConversationMeta', () => {
    const meta: ConversationMeta = {
      id: 'test-id',
      title: 'Test',
      messageCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: ['work', 'urgent'],
      pinned: true,
      preview: 'Hello...',
    };
    expect(meta.tags).toEqual(['work', 'urgent']);
    expect(meta.pinned).toBe(true);
    expect(meta.preview).toBe('Hello...');
  });
});
