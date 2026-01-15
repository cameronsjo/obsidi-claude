import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { ObsidianTools, ToolDefinition } from './obsidianTools';
import { createLogger } from './logger';

const log = createLogger('ObsidianMCPTools');

/**
 * Convert ObsidianTools' JSON Schema to Zod schema
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodRawShape {
  const properties = schema.properties as Record<string, { type: string; description?: string; items?: { type: string } }> | undefined;
  const required = (schema.required as string[]) || [];

  if (!properties) {
    return {};
  }

  const zodShape: z.ZodRawShape = {};

  for (const [key, prop] of Object.entries(properties)) {
    let zodType: z.ZodTypeAny;

    switch (prop.type) {
      case 'string':
        zodType = z.string();
        break;
      case 'number':
        zodType = z.number();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'array':
        if (prop.items?.type === 'string') {
          zodType = z.array(z.string());
        } else {
          zodType = z.array(z.any());
        }
        break;
      default:
        zodType = z.any();
    }

    if (prop.description) {
      zodType = zodType.describe(prop.description);
    }

    if (!required.includes(key)) {
      zodType = zodType.optional();
    }

    zodShape[key] = zodType;
  }

  return zodShape;
}

/**
 * Creates an SDK-compatible MCP server from ObsidianTools
 */
export function createObsidianMCPServer(
  obsidianTools: ObsidianTools,
  serverName = 'obsidian'
): McpSdkServerConfigWithInstance {
  const toolDefinitions = obsidianTools.getToolDefinitions();
  log.info('Creating Obsidian MCP server', { toolCount: toolDefinitions.length });

  const sdkTools = toolDefinitions.map((toolDef) => {
    const zodSchema = jsonSchemaToZod(toolDef.parameters);

    return tool(
      toolDef.name,
      toolDef.description,
      zodSchema,
      async (args: Record<string, unknown>) => {
        try {
          log.debug('Executing Obsidian tool', { tool: toolDef.name });
          const result = await toolDef.handler(args);
          return {
            content: [{ type: 'text' as const, text: result }],
          };
        } catch (error) {
          log.error('Obsidian tool error', error, { tool: toolDef.name });
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: error instanceof Error ? error.message : String(error),
                }),
              },
            ],
            isError: true,
          };
        }
      }
    );
  });

  const server = createSdkMcpServer({
    name: serverName,
    version: '1.0.0',
    tools: sdkTools,
  });

  log.info('Obsidian MCP server created', { serverName, tools: toolDefinitions.map((t) => t.name) });

  return server;
}

/**
 * Get allowed tool names for the Obsidian MCP server
 */
export function getObsidianToolNames(obsidianTools: ObsidianTools, serverName = 'obsidian'): string[] {
  return obsidianTools.getToolDefinitions().map((tool) => `mcp__${serverName}__${tool.name}`);
}
