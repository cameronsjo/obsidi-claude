import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BackendFactory } from '../src/backends/backendFactory';
import type { ObsidiClaudeSettings } from '../src/types';
import { DEFAULT_SETTINGS } from '../src/types';

// Mock Obsidian Platform
vi.mock('obsidian', () => ({
  Platform: {
    isDesktop: true,
    isMobile: false,
  },
}));

// Mock the SDK backend availability check
vi.mock('../src/claudePath', () => ({
  findClaudeCliPath: vi.fn(() => null), // CLI not available by default
  getEnhancedPath: vi.fn(() => process.env.PATH),
}));

// Mock ObsidianTools
const mockObsidianTools = {
  getToolDefinitions: vi.fn(() => []),
  getToolSchemas: vi.fn(() => []),
  executeTool: vi.fn(),
};

describe('BackendFactory', () => {
  let factory: BackendFactory;
  let settings: ObsidiClaudeSettings;

  beforeEach(() => {
    vi.clearAllMocks();
    settings = { ...DEFAULT_SETTINGS };
    factory = new BackendFactory(settings, mockObsidianTools as any);
  });

  describe('initialization', () => {
    it('should create factory with settings', () => {
      expect(factory).toBeInstanceOf(BackendFactory);
    });

    it('should provide backend info', () => {
      const info = factory.getBackendInfo();
      expect(info).toHaveProperty('current');
      expect(info).toHaveProperty('sdkAvailable');
      expect(info).toHaveProperty('apiAvailable');
      expect(info).toHaveProperty('platform');
    });
  });

  describe('backend selection', () => {
    it('should return api backend when SDK not available', () => {
      const backend = factory.getBackend();
      expect(backend.type).toBe('api');
    });

    it('should respect preferredBackend setting for api', () => {
      settings.preferredBackend = 'api';
      factory.updateSettings(settings);
      const backend = factory.getBackend();
      expect(backend.type).toBe('api');
    });
  });

  describe('settings updates', () => {
    it('should update settings', () => {
      const newSettings = { ...settings, model: 'claude-opus-4' as const };
      factory.updateSettings(newSettings);
      // Factory should not throw
      expect(factory.getBackend()).toBeDefined();
    });
  });

  describe('disposal', () => {
    it('should dispose backends', async () => {
      await factory.dispose();
      // Should not throw
    });
  });
});

describe('BackendFactory with API key', () => {
  let factory: BackendFactory;
  let settings: ObsidiClaudeSettings;

  beforeEach(() => {
    vi.clearAllMocks();
    settings = {
      ...DEFAULT_SETTINGS,
      anthropicApiKey: 'test-api-key',
    };
    factory = new BackendFactory(settings, mockObsidianTools as any);
  });

  it('should report API as available with key', () => {
    const info = factory.getBackendInfo();
    expect(info.apiAvailable).toBe(true);
  });

  it('should prefer API backend when SDK not available', () => {
    const backend = factory.getBackend();
    expect(backend.type).toBe('api');
  });
});
