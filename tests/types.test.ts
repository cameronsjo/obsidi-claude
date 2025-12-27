import { describe, it, expect } from 'vitest';
import {
  generateId,
  DEFAULT_SETTINGS,
  DEFAULT_EMBEDDING_SETTINGS,
  type ChatMessage,
  type Conversation,
  type ToolCallInfo,
} from '../src/types';

describe('generateId', () => {
  it('should generate a unique ID', () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });

  it('should return a string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
  });

  it('should contain a timestamp prefix', () => {
    const before = Date.now();
    const id = generateId();
    const after = Date.now();

    const timestamp = parseInt(id.split('-')[0], 10);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it('should have a random suffix', () => {
    const id = generateId();
    const parts = id.split('-');
    expect(parts.length).toBe(2);
    expect(parts[1].length).toBeGreaterThan(0);
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('should have required fields', () => {
    expect(DEFAULT_SETTINGS).toHaveProperty('model');
    expect(DEFAULT_SETTINGS).toHaveProperty('systemPrompt');
    expect(DEFAULT_SETTINGS).toHaveProperty('maxTurns');
    expect(DEFAULT_SETTINGS).toHaveProperty('workingDirectory');
    expect(DEFAULT_SETTINGS).toHaveProperty('allowedTools');
    expect(DEFAULT_SETTINGS).toHaveProperty('permissionMode');
    expect(DEFAULT_SETTINGS).toHaveProperty('showToolCalls');
    expect(DEFAULT_SETTINGS).toHaveProperty('streamResponses');
    expect(DEFAULT_SETTINGS).toHaveProperty('embedding');
  });

  it('should have valid model', () => {
    expect(['claude-sonnet-4-5', 'claude-opus-4', 'claude-3-5-sonnet-20241022']).toContain(
      DEFAULT_SETTINGS.model
    );
  });

  it('should have reasonable maxTurns', () => {
    expect(DEFAULT_SETTINGS.maxTurns).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.maxTurns).toBeLessThanOrEqual(100);
  });

  it('should have valid permissionMode', () => {
    expect(['default', 'acceptEdits', 'bypassPermissions']).toContain(
      DEFAULT_SETTINGS.permissionMode
    );
  });

  it('should include essential tools', () => {
    expect(DEFAULT_SETTINGS.allowedTools).toContain('Read');
    expect(DEFAULT_SETTINGS.allowedTools).toContain('Write');
    expect(DEFAULT_SETTINGS.allowedTools).toContain('Edit');
  });
});

describe('DEFAULT_EMBEDDING_SETTINGS', () => {
  it('should have required fields', () => {
    expect(DEFAULT_EMBEDDING_SETTINGS).toHaveProperty('enabled');
    expect(DEFAULT_EMBEDDING_SETTINGS).toHaveProperty('provider');
    expect(DEFAULT_EMBEDDING_SETTINGS).toHaveProperty('autoIndex');
    expect(DEFAULT_EMBEDDING_SETTINGS).toHaveProperty('chunkSize');
    expect(DEFAULT_EMBEDDING_SETTINGS).toHaveProperty('chunkOverlap');
    expect(DEFAULT_EMBEDDING_SETTINGS).toHaveProperty('excludeFolders');
  });

  it('should be disabled by default', () => {
    expect(DEFAULT_EMBEDDING_SETTINGS.enabled).toBe(false);
  });

  it('should have valid provider', () => {
    expect(['transformers', 'ollama', 'openai', 'voyage']).toContain(
      DEFAULT_EMBEDDING_SETTINGS.provider
    );
  });

  it('should have reasonable chunk settings', () => {
    expect(DEFAULT_EMBEDDING_SETTINGS.chunkSize).toBeGreaterThan(0);
    expect(DEFAULT_EMBEDDING_SETTINGS.chunkOverlap).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_EMBEDDING_SETTINGS.chunkOverlap).toBeLessThan(
      DEFAULT_EMBEDDING_SETTINGS.chunkSize
    );
  });

  it('should exclude common non-content folders', () => {
    expect(DEFAULT_EMBEDDING_SETTINGS.excludeFolders).toContain('.obsidian');
    expect(DEFAULT_EMBEDDING_SETTINGS.excludeFolders).toContain('.trash');
  });
});

describe('Type structures', () => {
  it('should create valid ChatMessage', () => {
    const message: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    };
    expect(message.id).toBeDefined();
    expect(message.role).toBe('user');
    expect(message.content).toBe('Hello');
  });

  it('should create valid ToolCallInfo', () => {
    const toolCall: ToolCallInfo = {
      name: 'Read',
      input: { path: '/test.md' },
      status: 'pending',
    };
    expect(toolCall.name).toBe('Read');
    expect(toolCall.status).toBe('pending');
  });

  it('should create valid Conversation', () => {
    const conversation: Conversation = {
      id: generateId(),
      title: 'Test Conversation',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(conversation.id).toBeDefined();
    expect(conversation.title).toBe('Test Conversation');
    expect(conversation.messages).toHaveLength(0);
  });
});
