import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { ObsidiClaudeSettings } from '../src/types';
import { DEFAULT_SETTINGS } from '../src/types';
import type { ObsidianTools } from '../src/obsidianTools';

// Track mock instances for verification
let mockSDKInstance: ReturnType<typeof createMockBackend>;
let mockAPIInstance: ReturnType<typeof createMockBackend>;

function createMockBackend(type: 'sdk' | 'api') {
  return {
    type,
    isAvailable: vi.fn().mockReturnValue(true),
    initialize: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    updateSettings: vi.fn(),
    sendMessage: vi.fn(),
    abort: vi.fn(),
  };
}

// Mock the Platform module from obsidian
vi.mock('obsidian', () => ({
  Platform: {
    isDesktopApp: true,
    isMobile: false,
  },
}));

// Mock the SDK backend - use function constructor pattern
vi.mock('../src/backends/sdkAgentBackend', () => {
  return {
    SDKAgentBackend: function SDKAgentBackend() {
      mockSDKInstance = createMockBackend('sdk');
      return mockSDKInstance;
    },
  };
});

// Mock the API backend - use function constructor pattern
vi.mock('../src/backends/apiAgentBackend', () => {
  return {
    APIAgentBackend: function APIAgentBackend() {
      mockAPIInstance = createMockBackend('api');
      return mockAPIInstance;
    },
  };
});

// Import after mocks are set up
import { BackendFactory } from '../src/backends/backendFactory';
import { Platform } from 'obsidian';

describe('BackendFactory', () => {
  let factory: BackendFactory;
  let settings: ObsidiClaudeSettings;
  let mockTools: ObsidianTools;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSDKInstance = undefined as unknown as ReturnType<typeof createMockBackend>;
    mockAPIInstance = undefined as unknown as ReturnType<typeof createMockBackend>;

    settings = { ...DEFAULT_SETTINGS };
    mockTools = {} as ObsidianTools;

    // Reset Platform mock to desktop by default
    (Platform as { isDesktopApp: boolean; isMobile: boolean }).isDesktopApp = true;
    (Platform as { isDesktopApp: boolean; isMobile: boolean }).isMobile = false;

    factory = new BackendFactory(settings, mockTools);
  });

  describe('getBackend', () => {
    it('should return SDK backend on desktop with auto preference', () => {
      settings.preferredBackend = 'auto';
      factory = new BackendFactory(settings, mockTools);
      const backend = factory.getBackend();
      expect(backend.type).toBe('sdk');
    });

    it('should return API backend when explicitly requested', () => {
      settings.preferredBackend = 'api';
      factory = new BackendFactory(settings, mockTools);
      const backend = factory.getBackend();
      expect(backend.type).toBe('api');
    });

    it('should return SDK backend when explicitly requested on desktop', () => {
      settings.preferredBackend = 'sdk';
      factory = new BackendFactory(settings, mockTools);
      const backend = factory.getBackend();
      expect(backend.type).toBe('sdk');
    });

    it('should fall back to API when SDK not available', () => {
      settings.preferredBackend = 'auto';
      factory = new BackendFactory(settings, mockTools);

      // First call creates SDK, make it unavailable
      const sdk = factory.getSDKBackend();
      sdk?.isAvailable.mockReturnValue(false);

      // Clear the current backend to force re-selection
      (factory as unknown as { currentBackend: null }).currentBackend = null;

      const backend = factory.getBackend();
      expect(backend.type).toBe('api');
    });

    it('should return API backend on mobile', () => {
      (Platform as { isDesktopApp: boolean; isMobile: boolean }).isDesktopApp = false;
      (Platform as { isDesktopApp: boolean; isMobile: boolean }).isMobile = true;

      settings.preferredBackend = 'auto';
      factory = new BackendFactory(settings, mockTools);
      const backend = factory.getBackend();
      expect(backend.type).toBe('api');
    });
  });

  describe('getSDKBackend', () => {
    it('should return SDK backend on desktop', () => {
      const sdk = factory.getSDKBackend();
      expect(sdk).not.toBeNull();
      expect(sdk?.type).toBe('sdk');
    });

    it('should return null on mobile', () => {
      (Platform as { isDesktopApp: boolean; isMobile: boolean }).isMobile = true;

      factory = new BackendFactory(settings, mockTools);
      const sdk = factory.getSDKBackend();
      expect(sdk).toBeNull();
    });

    it('should reuse the same instance', () => {
      const sdk1 = factory.getSDKBackend();
      const sdk2 = factory.getSDKBackend();
      expect(sdk1).toBe(sdk2);
    });
  });

  describe('getAPIBackend', () => {
    it('should return API backend', () => {
      const api = factory.getAPIBackend();
      expect(api).not.toBeNull();
      expect(api.type).toBe('api');
    });

    it('should reuse the same instance', () => {
      const api1 = factory.getAPIBackend();
      const api2 = factory.getAPIBackend();
      expect(api1).toBe(api2);
    });
  });

  describe('getCurrentBackend', () => {
    it('should return null before any backend is selected', () => {
      expect(factory.getCurrentBackend()).toBeNull();
    });

    it('should return the current backend after selection', () => {
      factory.getBackend();
      expect(factory.getCurrentBackend()).not.toBeNull();
    });
  });

  describe('updateSettings', () => {
    it('should update settings on all instantiated backends', () => {
      const sdk = factory.getSDKBackend();
      const api = factory.getAPIBackend();

      const newSettings = { ...settings, model: 'claude-opus-4' as const };
      factory.updateSettings(newSettings);

      expect(sdk?.updateSettings).toHaveBeenCalledWith(newSettings);
      expect(api.updateSettings).toHaveBeenCalledWith(newSettings);
    });
  });

  describe('dispose', () => {
    it('should dispose all backends', async () => {
      const sdk = factory.getSDKBackend();
      const api = factory.getAPIBackend();

      await factory.dispose();

      expect(sdk?.dispose).toHaveBeenCalled();
      expect(api.dispose).toHaveBeenCalled();
    });

    it('should clear backend references', async () => {
      factory.getBackend(); // Initialize a backend
      await factory.dispose();
      expect(factory.getCurrentBackend()).toBeNull();
    });
  });

  describe('isSDKAvailable', () => {
    it('should return true on desktop when SDK is available', () => {
      expect(factory.isSDKAvailable()).toBe(true);
    });

    it('should return false on mobile', () => {
      (Platform as { isDesktopApp: boolean; isMobile: boolean }).isDesktopApp = false;
      (Platform as { isDesktopApp: boolean; isMobile: boolean }).isMobile = true;

      factory = new BackendFactory(settings, mockTools);
      expect(factory.isSDKAvailable()).toBe(false);
    });

    it('should return false when SDK reports unavailable', () => {
      const sdk = factory.getSDKBackend();
      sdk?.isAvailable.mockReturnValue(false);
      expect(factory.isSDKAvailable()).toBe(false);
    });
  });

  describe('getBackendInfo', () => {
    it('should return backend info', () => {
      factory.getBackend(); // Initialize
      const info = factory.getBackendInfo();

      expect(info).toEqual({
        current: expect.stringMatching(/sdk|api/),
        sdkAvailable: true,
        apiAvailable: true,
        platform: 'desktop',
      });
    });

    it('should show mobile platform on mobile', () => {
      (Platform as { isDesktopApp: boolean; isMobile: boolean }).isDesktopApp = false;
      (Platform as { isDesktopApp: boolean; isMobile: boolean }).isMobile = true;

      factory = new BackendFactory(settings, mockTools);
      factory.getBackend();
      const info = factory.getBackendInfo();

      expect(info.platform).toBe('mobile');
    });
  });
});
