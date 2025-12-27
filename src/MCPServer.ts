import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { ObsidianTools } from './ObsidianTools';
import { createLogger } from './Logger';

const log = createLogger('MCPServer');

export interface MCPServerConfig {
  name: string;
  version: string;
}

/**
 * MCP Server that exposes Obsidian vault tools to external Claude instances
 *
 * This allows Claude Code or other MCP clients to interact with the Obsidian vault
 * using the same tools available in the plugin's chat interface.
 */
export class MCPServer {
  private server: Server | null = null;
  private transport: StdioServerTransport | null = null;
  private tools: ObsidianTools;
  private config: MCPServerConfig;
  private isRunning = false;

  constructor(tools: ObsidianTools, config: MCPServerConfig) {
    this.tools = tools;
    this.config = config;
  }

  /**
   * Start the MCP server with stdio transport
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn('MCP server already running');
      return;
    }

    log.info('Starting MCP server', { name: this.config.name, version: this.config.version });

    this.server = new Server(
      { name: this.config.name, version: this.config.version },
      { capabilities: { tools: { listChanged: true } } }
    );

    this.setupHandlers();

    this.transport = new StdioServerTransport();
    await this.server.connect(this.transport);

    this.isRunning = true;
    log.info('MCP server started successfully');
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
      if (this.server) {
        await this.server.close();
        this.server = null;
      }
      this.transport = null;
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
   * Setup request handlers for tools
   */
  private setupHandlers(): void {
    if (!this.server) return;

    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
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
    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      const { name, arguments: args } = request.params;
      log.info('Tool call received', { tool: name });

      try {
        const result = await this.tools.executeTool(name, args as Record<string, unknown> || {});
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
export function createMCPServer(tools: ObsidianTools): MCPServer {
  return new MCPServer(tools, {
    name: 'obsidi-claude',
    version: '0.1.0',
  });
}
