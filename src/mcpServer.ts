import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  isInitializeRequest,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import express, { type Express, type Request, type Response } from 'express';
import type { Server as HttpServer } from 'http';
import type { ObsidianTools } from './obsidianTools';
import { createLogger } from './logger';

const log = createLogger('MCPServer');

export type MCPTransportType = 'stdio' | 'http' | 'both';

export interface MCPServerConfig {
  name: string;
  version: string;
  transport: MCPTransportType;
  httpPort: number;
  /** Session idle timeout in milliseconds (default: 30 minutes) */
  sessionTimeoutMs?: number;
  /** How often to check for expired sessions in milliseconds (default: 5 minutes) */
  cleanupIntervalMs?: number;
  /** Maximum concurrent sessions (default: 100) */
  maxSessions?: number;
  /** Callbacks for session persistence (enables hot reload recovery) */
  sessionPersistence?: {
    loadStaleSessionIds: () => Set<string>;
    saveSessionIds: (sessionIds: string[]) => void;
    clearSessionIds: () => void;
  };
}

const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_SESSIONS = 100;

interface SessionTransport {
  transport: StreamableHTTPServerTransport;
  server: Server;
  lastActivityTime: number;
}

/**
 * MCP Server that exposes Obsidian vault tools to external Claude instances
 *
 * Supports both stdio and HTTP transports. HTTP mode allows multiple clients
 * to connect via REST API on a configurable port.
 */
export class MCPServer {
  private stdioServer: Server | null = null;
  private stdioTransport: StdioServerTransport | null = null;
  private httpApp: Express | null = null;
  private httpServer: HttpServer | null = null;
  private httpSessions: Map<string, SessionTransport> = new Map();
  private staleSessionIds: Set<string> = new Set();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private tools: ObsidianTools;
  private config: MCPServerConfig;
  private isRunning = false;

  constructor(tools: ObsidianTools, config: MCPServerConfig) {
    this.tools = tools;
    this.config = config;
  }

  /**
   * Start the MCP server with configured transport(s)
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn('MCP server already running');
      return;
    }

    log.info('Starting MCP server', {
      name: this.config.name,
      version: this.config.version,
      transport: this.config.transport,
    });

    try {
      if (this.config.transport === 'stdio' || this.config.transport === 'both') {
        await this.startStdioServer();
      }

      if (this.config.transport === 'http' || this.config.transport === 'both') {
        await this.startHttpServer();
      }

      this.isRunning = true;
      log.info('MCP server started successfully');
    } catch (error) {
      log.error('Failed to start MCP server', error);
      await this.stop();
      throw error;
    }
  }

  /**
   * Start the stdio transport server
   */
  private async startStdioServer(): Promise<void> {
    log.debug('Starting stdio transport');

    this.stdioServer = new Server(
      { name: this.config.name, version: this.config.version },
      { capabilities: { tools: { listChanged: true } } }
    );

    this.setupServerHandlers(this.stdioServer);

    this.stdioTransport = new StdioServerTransport();
    await this.stdioServer.connect(this.stdioTransport);

    log.info('Stdio transport started');
  }

  /**
   * Start the HTTP transport server
   */
  private async startHttpServer(): Promise<void> {
    log.debug('Starting HTTP transport', { port: this.config.httpPort });

    // Load stale session IDs from before last restart (enables hot reload recovery)
    if (this.config.sessionPersistence) {
      this.staleSessionIds = this.config.sessionPersistence.loadStaleSessionIds();
      if (this.staleSessionIds.size > 0) {
        log.info('Loaded stale session IDs for recovery', { count: this.staleSessionIds.size });
      }
    }

    this.httpApp = express();
    this.httpApp.use(express.json());

    // Health check endpoint
    this.httpApp.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        name: this.config.name,
        version: this.config.version,
        activeSessions: this.httpSessions.size,
      });
    });

    // MCP endpoint - handles POST, GET, DELETE for session management
    this.httpApp.post('/mcp', async (req: Request, res: Response) => {
      await this.handleMcpRequest(req, res);
    });

    this.httpApp.get('/mcp', async (req: Request, res: Response) => {
      await this.handleMcpRequest(req, res);
    });

    this.httpApp.delete('/mcp', async (req: Request, res: Response) => {
      await this.handleMcpRequest(req, res);
    });

    // Start listening
    await new Promise<void>((resolve, reject) => {
      try {
        this.httpServer = this.httpApp!.listen(this.config.httpPort, () => {
          log.info('HTTP transport started', {
            port: this.config.httpPort,
            url: `http://localhost:${this.config.httpPort}/mcp`,
          });
          resolve();
        });

        this.httpServer.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            reject(new Error(`Port ${this.config.httpPort} is already in use`));
          } else {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });

    // Start session cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Handle incoming MCP requests over HTTP
   */
  private async handleMcpRequest(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    try {
      // Check for existing active session
      if (sessionId && this.httpSessions.has(sessionId)) {
        const session = this.httpSessions.get(sessionId)!;
        // Refresh activity time on each request
        session.lastActivityTime = Date.now();
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      // Check for stale session (existed before hot reload) - auto-recover
      if (sessionId && this.staleSessionIds.has(sessionId)) {
        log.info('Recovering stale session after hot reload', { sessionId });
        await this.recoverStaleSession(sessionId, req, res);
        return;
      }

      // New session - only allow if it's an initialize request
      if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
        await this.createNewSession(req, res);
        return;
      }

      // Invalid request
      const message = sessionId
        ? 'Invalid or expired session. Please reinitialize the MCP connection.'
        : 'Missing session ID or not an initialize request';
      log.warn('Invalid MCP request', { sessionId, hasSessionId: !!sessionId, method: req.method });
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message,
        },
        id: null,
      });
    } catch (error) {
      log.error('Error handling MCP request', error);
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
        },
        id: null,
      });
    }
  }

  /**
   * Create a new MCP session for an initialize request
   */
  private async createNewSession(req: Request, res: Response): Promise<void> {
    // Check max sessions limit
    const maxSessions = this.config.maxSessions ?? DEFAULT_MAX_SESSIONS;
    if (this.httpSessions.size >= maxSessions) {
      log.warn('Max sessions limit reached', { current: this.httpSessions.size, max: maxSessions });
      res.status(503).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Server is at maximum capacity. Please try again later.',
        },
        id: null,
      });
      return;
    }

    await this.createSessionWithTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      logMessage: 'HTTP session initialized',
      req,
      res,
    });
  }

  /**
   * Recover a stale session by creating a new transport with the same session ID
   */
  private async recoverStaleSession(sessionId: string, req: Request, res: Response): Promise<void> {
    this.staleSessionIds.delete(sessionId);

    await this.createSessionWithTransport({
      sessionIdGenerator: () => sessionId,
      logMessage: 'Stale session recovered',
      req,
      res,
    });
  }

  /**
   * Create a session with transport - shared logic for new and recovered sessions
   */
  private async createSessionWithTransport(options: {
    sessionIdGenerator: () => string;
    logMessage: string;
    req: Request;
    res: Response;
  }): Promise<void> {
    const { sessionIdGenerator, logMessage, req, res } = options;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator,
      onsessioninitialized: (id: string) => {
        const server = this.createMcpServer();
        this.httpSessions.set(id, { transport, server, lastActivityTime: Date.now() });
        log.info(logMessage, { sessionId: id, activeSessions: this.httpSessions.size });
      },
      onsessionclosed: (id: string) => {
        this.httpSessions.delete(id);
        log.info('HTTP session closed', { sessionId: id });
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        this.httpSessions.delete(transport.sessionId);
      }
    };

    const server = this.createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  /**
   * Create a new MCP server instance with handlers configured
   */
  private createMcpServer(): Server {
    const server = new Server(
      { name: this.config.name, version: this.config.version },
      { capabilities: { tools: { listChanged: true } } }
    );
    this.setupServerHandlers(server);
    return server;
  }

  /**
   * Start the session cleanup interval
   */
  private startCleanupInterval(): void {
    const intervalMs = this.config.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    this.cleanupInterval = setInterval(() => this.cleanupExpiredSessions(), intervalMs);
    log.debug('Session cleanup interval started', { intervalMs });
  }

  /**
   * Stop the session cleanup interval
   */
  private stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      log.debug('Session cleanup interval stopped');
    }
  }

  /**
   * Remove sessions that have been idle longer than the timeout
   */
  private cleanupExpiredSessions(): void {
    const timeoutMs = this.config.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of this.httpSessions) {
      const idleTime = now - session.lastActivityTime;
      if (idleTime > timeoutMs) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      const session = this.httpSessions.get(sessionId);
      if (session) {
        try {
          session.server.close();
        } catch {
          // Ignore close errors
        }
        this.httpSessions.delete(sessionId);
        log.info('Expired session cleaned up', { sessionId, idleTimeMs: now - session.lastActivityTime });
      }
    }

    if (expiredSessions.length > 0) {
      log.debug('Session cleanup completed', { removed: expiredSessions.length, remaining: this.httpSessions.size });
    }
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    log.info('Stopping MCP server');

    try {
      // Stop cleanup interval
      this.stopCleanupInterval();

      // Stop stdio server
      if (this.stdioServer) {
        await this.stdioServer.close();
        this.stdioServer = null;
        this.stdioTransport = null;
      }

      // Stop HTTP server and close all sessions
      if (this.httpServer) {
        // Save session IDs before clearing (enables hot reload recovery)
        if (this.config.sessionPersistence && this.httpSessions.size > 0) {
          const sessionIds = Array.from(this.httpSessions.keys());
          this.config.sessionPersistence.saveSessionIds(sessionIds);
          log.info('Saved session IDs for hot reload recovery', { count: sessionIds.length });
        }

        // Close all active sessions
        for (const [sessionId, session] of this.httpSessions) {
          try {
            await session.server.close();
          } catch {
            log.debug('Error closing session', { sessionId });
          }
        }
        this.httpSessions.clear();

        await new Promise<void>((resolve) => {
          this.httpServer!.close(() => resolve());
        });
        this.httpServer = null;
        this.httpApp = null;
      }

      this.isRunning = false;
      log.info('MCP server stopped');
    } catch (error) {
      log.error('Error stopping MCP server', error);
      throw error;
    }
  }

  /**
   * Check if the server is running
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get current server status
   */
  getStatus(): { running: boolean; transport: MCPTransportType; httpPort?: number; activeSessions?: number } {
    return {
      running: this.isRunning,
      transport: this.config.transport,
      httpPort: this.config.transport !== 'stdio' ? this.config.httpPort : undefined,
      activeSessions: this.httpSessions.size,
    };
  }

  /**
   * Setup request handlers for a server instance
   */
  private setupServerHandlers(server: Server): void {
    // Handle tool listing
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const toolSchemas = this.tools.getToolSchemas();
      log.debug('Listing tools', { count: toolSchemas.length });

      return {
        tools: toolSchemas.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.input_schema,
        })),
      };
    });

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      const { name, arguments: args } = request.params;
      log.info('Tool call received', { tool: name });

      try {
        const result = await this.tools.executeTool(name, (args as Record<string, unknown>) || {});
        log.debug('Tool call completed', { tool: name, resultLength: result.length });

        return {
          content: [{ type: 'text', text: result }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Tool call failed', error, { tool: name });

        return {
          content: [{ type: 'text', text: JSON.stringify({ error: errorMessage }) }],
          isError: true,
        };
      }
    });
  }
}

/**
 * Create and configure an MCP server instance
 */
export function createMCPServer(
  tools: ObsidianTools,
  config?: Partial<MCPServerConfig>
): MCPServer {
  return new MCPServer(tools, {
    name: config?.name ?? 'obsidi-claude',
    version: config?.version ?? '0.1.0',
    transport: config?.transport ?? 'http',
    httpPort: config?.httpPort ?? 3000,
  });
}
