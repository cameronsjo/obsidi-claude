# MCP Server Integration

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Obsidian Plugin                          │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  SDKAgentBackend                                        ││
│  │  ┌─────────────────┐  ┌─────────────────────────────┐  ││
│  │  │ Obsidian MCP    │  │ External MCP Configs        │  ││
│  │  │ (In-Process)    │  │ (passed to Claude Code)     │  ││
│  │  └────────┬────────┘  └──────────────┬──────────────┘  ││
│  │           │                          │                  ││
│  │           └──────────┬───────────────┘                  ││
│  │                      ▼                                  ││
│  │              query(mcpServers: {...})                   ││
│  └──────────────────────┬──────────────────────────────────┘│
└─────────────────────────┼───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Claude Code CLI                           │
│  (spawned subprocess with enhanced PATH)                    │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ Obsidian MCP    │  │ External MCPs   │                  │
│  │ (in-process)    │  │ (spawned here)  │                  │
│  └─────────────────┘  └─────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

## MCP Server Types

### 1. In-Process SDK Servers (Recommended for Plugin Tools)

Used for our Obsidian tools - runs in the same JavaScript process:

```typescript
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

const obsidianServer = createSdkMcpServer({
  name: 'obsidian',
  tools: {
    search_content: tool({
      description: 'Search vault content',
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        // Direct access to Obsidian API
        return await vault.search(query);
      }
    })
  }
});
```

**Advantages:**
- Zero subprocess overhead
- Direct access to Obsidian API and vault
- Shared state, no serialization
- Works perfectly in Electron

### 2. Stdio MCP Servers (For External Tools)

External servers spawned as subprocesses by Claude Code CLI:

```typescript
mcpServers: {
  playwright: {
    type: 'stdio',
    command: 'npx',
    args: ['@playwright/mcp@latest'],
    env: { DEBUG: '1' }  // Merged into parent env
  }
}
```

**Important:** These are spawned by Claude Code CLI, NOT by the Obsidian plugin directly. This means:
- Claude Code handles PATH resolution
- We enhance PATH before spawning Claude Code
- The plugin cannot directly test these servers

### 3. SSE/HTTP Servers (For Remote Services)

Network-based MCP servers:

```typescript
mcpServers: {
  api: {
    type: 'sse',
    url: 'https://api.example.com/mcp',
    headers: { Authorization: 'Bearer ...' }
  }
}
```

## Configuration Flow

1. **User configures external MCP server** in settings:
   - Name, command, args, environment variables

2. **SDKAgentBackend builds mcpServers config:**
   ```typescript
   const mcpServers = {};

   // In-process Obsidian server
   mcpServers.obsidian = this.obsidianMcpServer;

   // External servers from settings
   for (const server of settings.externalMcpServers) {
     if (server.enabled) {
       mcpServers[server.name] = {
         type: 'stdio',
         command: server.command,
         args: server.args,
         env: server.env
       };
     }
   }
   ```

3. **Passed to query()** - Claude Code handles spawning

## PATH Handling

Obsidian/Electron has a limited PATH. We enhance it before spawning Claude Code:

```typescript
// In SDKAgentBackend.sendMessage()
const enhancedPath = getEnhancedPath();
if (enhancedPath !== process.env.PATH) {
  process.env.PATH = enhancedPath;
}
```

`getEnhancedPath()` adds common locations:
- `/opt/homebrew/bin` (macOS ARM)
- `/usr/local/bin` (macOS Intel, Linux)
- `~/.nvm/versions/node/*/bin` (nvm)
- `~/.local/share/fnm/*/bin` (fnm)
- `~/.npm-global/bin` (npm global)

## Testing MCP Servers

**Limitation:** We cannot directly spawn external MCP servers from Obsidian to test them because:
1. Obsidian's environment has limited PATH
2. Even with PATH enhancement, shell spawning is unreliable
3. The servers are designed to be spawned by Claude Code

**Current approach:**
- Validate configuration syntax
- Show warning that server will be tested when used
- Log detailed errors if server fails during conversation

**Future improvement:**
- Use Claude Code to test: `claude --mcp-test server-name`
- Or spawn a quick query that exercises the server

## Tool Naming Convention

MCP tools are namespaced:

```
mcp__<serverName>__<toolName>
```

Examples:
- `mcp__obsidian__search_content`
- `mcp__playwright__navigate`
- `mcp__filesystem__read_file`

Add to `allowedTools` to enable:

```typescript
allowedTools: [
  ...settings.allowedTools,
  ...getObsidianToolNames(obsidianTools, 'obsidian'),
  // External MCP tools are allowed automatically
]
```

## Troubleshooting

### "command not found" errors

1. Check if command exists: `which <command>`
2. Use absolute path in config
3. Verify PATH includes command location

### Server doesn't respond

1. Check server logs in Claude Code output
2. Verify server implements MCP protocol correctly
3. Test server manually: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize",...}' | <command>`

### Permission errors

1. Ensure executable permissions: `chmod +x <script>`
2. Check file ownership
3. Verify env variables are correct
