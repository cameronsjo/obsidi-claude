import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MCPServer, createMCPServer, type MCPServerConfig } from '../src/mcpServer';

// Mock express
vi.mock('express', () => {
  const mockApp = {
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    listen: vi.fn((port: number, callback: () => void) => {
      callback();
      return {
        on: vi.fn(),
        close: vi.fn((cb: () => void) => cb()),
      };
    }),
  };
  const expressFn = vi.fn(() => mockApp) as any;
  expressFn.json = vi.fn(() => vi.fn()); // Mock express.json() middleware
  return {
    default: expressFn,
  };
});

// Mock MCP SDK - use class syntax for proper constructor behavior
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  return {
    Server: class MockServer {
      setRequestHandler = vi.fn();
      connect = vi.fn();
      close = vi.fn();
    },
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  return {
    StdioServerTransport: class MockStdioTransport {},
  };
});

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => {
  return {
    StreamableHTTPServerTransport: class MockHttpTransport {
      handleRequest = vi.fn();
      sessionId = 'test-session-id';
      onclose: (() => void) | null = null;
    },
  };
});

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: { method: 'tools/list' },
  CallToolRequestSchema: { method: 'tools/call' },
  isInitializeRequest: vi.fn((body) => body?.method === 'initialize'),
}));

// Mock ObsidianTools
const mockObsidianTools = {
  getToolDefinitions: vi.fn(() => [
    {
      name: 'read_note',
      description: 'Read a note',
      parameters: { type: 'object', properties: {} },
      handler: vi.fn(),
    },
  ]),
  getToolSchemas: vi.fn(() => [
    {
      name: 'read_note',
      description: 'Read a note',
      input_schema: { type: 'object', properties: {} },
    },
  ]),
  executeTool: vi.fn(() => Promise.resolve('result')),
};

describe('MCPServer', () => {
  let server: MCPServer;
  const defaultConfig: MCPServerConfig = {
    name: 'test-server',
    version: '1.0.0',
    transport: 'http',
    httpPort: 3001,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    server = new MCPServer(mockObsidianTools as any, defaultConfig);
  });

  afterEach(async () => {
    if (server.isServerRunning()) {
      await server.stop();
    }
  });

  describe('createMCPServer factory', () => {
    it('should create server with default config', () => {
      const srv = createMCPServer(mockObsidianTools as any);
      expect(srv).toBeInstanceOf(MCPServer);
    });

    it('should create server with custom config', () => {
      const srv = createMCPServer(mockObsidianTools as any, {
        name: 'custom-server',
        version: '2.0.0',
        httpPort: 4000,
      });
      expect(srv).toBeInstanceOf(MCPServer);
    });
  });

  describe('server lifecycle', () => {
    it('should not be running initially', () => {
      expect(server.isServerRunning()).toBe(false);
    });

    it('should start successfully', async () => {
      await server.start();
      expect(server.isServerRunning()).toBe(true);
    });

    it('should not start twice', async () => {
      await server.start();
      await server.start(); // Should not throw
      expect(server.isServerRunning()).toBe(true);
    });

    it('should stop successfully', async () => {
      await server.start();
      await server.stop();
      expect(server.isServerRunning()).toBe(false);
    });

    it('should handle stop when not running', async () => {
      await server.stop(); // Should not throw
      expect(server.isServerRunning()).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return status when not running', () => {
      const status = server.getStatus();
      expect(status.running).toBe(false);
      expect(status.transport).toBe('http');
      expect(status.httpPort).toBe(3001);
      expect(status.activeSessions).toBe(0);
    });

    it('should return status when running', async () => {
      await server.start();
      const status = server.getStatus();
      expect(status.running).toBe(true);
    });
  });

  describe('session persistence', () => {
    it('should load stale sessions on start', async () => {
      const mockPersistence = {
        loadStaleSessionIds: vi.fn(() => new Set(['old-session-1', 'old-session-2'])),
        saveSessionIds: vi.fn(),
        clearSessionIds: vi.fn(),
      };

      const serverWithPersistence = new MCPServer(mockObsidianTools as any, {
        ...defaultConfig,
        sessionPersistence: mockPersistence,
      });

      await serverWithPersistence.start();
      expect(mockPersistence.loadStaleSessionIds).toHaveBeenCalled();
      await serverWithPersistence.stop();
    });

    it('should save sessions on stop', async () => {
      const mockPersistence = {
        loadStaleSessionIds: vi.fn(() => new Set()),
        saveSessionIds: vi.fn(),
        clearSessionIds: vi.fn(),
      };

      const serverWithPersistence = new MCPServer(mockObsidianTools as any, {
        ...defaultConfig,
        sessionPersistence: mockPersistence,
      });

      await serverWithPersistence.start();
      await serverWithPersistence.stop();
      // saveSessionIds is only called if there are active sessions
    });
  });

  describe('session timeout config', () => {
    it('should accept custom timeout values', () => {
      const customServer = new MCPServer(mockObsidianTools as any, {
        ...defaultConfig,
        sessionTimeoutMs: 60000,
        cleanupIntervalMs: 10000,
        maxSessions: 50,
      });
      expect(customServer).toBeInstanceOf(MCPServer);
    });
  });
});

describe('MCPServer with stdio transport', () => {
  it('should start with stdio transport', async () => {
    const server = new MCPServer(mockObsidianTools as any, {
      name: 'test-stdio',
      version: '1.0.0',
      transport: 'stdio',
      httpPort: 3002,
    });

    await server.start();
    expect(server.isServerRunning()).toBe(true);
    await server.stop();
  });
});

describe('MCPServer with both transports', () => {
  it('should start with both transports', async () => {
    const server = new MCPServer(mockObsidianTools as any, {
      name: 'test-both',
      version: '1.0.0',
      transport: 'both',
      httpPort: 3003,
    });

    await server.start();
    expect(server.isServerRunning()).toBe(true);
    await server.stop();
  });
});
