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
import type { ObsidianTools } from './ObsidianTools';
import { createLogger } from './Logger';

const log = createLogger('MCPServer');

export type MCPTransportType = 'stdio' | 'http' | 'both';

export interface MCPServerConfig {
  name: string;
  version: string;
  transport: MCPTransportType;
  httpPort: number;
}

interface SessionTransport {
  transport: StreamableHTTPServerTransport;
  server: Server;
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
  }

  /**
   * Handle incoming MCP requests over HTTP
   */
  private async handleMcpRequest(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    try {
      // Check for existing session
      if (sessionId && this.httpSessions.has(sessionId)) {
        const session = this.httpSessions.get(sessionId)!;
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      // New session - only allow if it's an initialize request
      if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id: string) => {
            const server = this.createMcpServer();
            this.httpSessions.set(id, { transport, server });
            log.info('HTTP session initialized', { sessionId: id });
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
        return;
      }

      // Invalid request
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: sessionId ? 'Invalid or expired session' : 'Missing session ID or not an initialize request',
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
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    log.info('Stopping MCP server');

    try {
      // Stop stdio server
      if (this.stdioServer) {
        await this.stdioServer.close();
        this.stdioServer = null;
        this.stdioTransport = null;
      }

      // Stop HTTP server and close all sessions
      if (this.httpServer) {
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
