#!/usr/bin/env node
/**
 * Stdio-to-HTTP bridge for MCP servers
 *
 * Claude Desktop only supports stdio MCP servers. This bridge:
 * 1. Reads JSON-RPC messages from stdin
 * 2. Forwards them to an HTTP MCP server
 * 3. Writes responses to stdout
 *
 * Usage:
 *   node stdio-http-bridge.mjs [--port 3000] [--host localhost]
 *
 * Claude Desktop config (~/.claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "obsidi-claude": {
 *         "command": "node",
 *         "args": ["/path/to/stdio-http-bridge.mjs", "--port", "3000"]
 *       }
 *     }
 *   }
 */

import { createInterface } from 'readline';

// Parse command line args
const args = process.argv.slice(2);
let port = 3000;
let host = 'localhost';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--host' && args[i + 1]) {
    host = args[i + 1];
    i++;
  }
}

const baseUrl = `http://${host}:${port}`;
let sessionId = null;

/**
 * Parse SSE stream and extract JSON messages
 */
function parseSSEEvents(text) {
  const events = [];
  const lines = text.split('\n');
  let currentData = '';

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      currentData += line.slice(6);
    } else if (line === '' && currentData) {
      // Empty line marks end of event
      try {
        events.push(JSON.parse(currentData));
      } catch {
        // Not valid JSON, skip
      }
      currentData = '';
    }
  }

  // Handle any remaining data
  if (currentData) {
    try {
      events.push(JSON.parse(currentData));
    } catch {
      // Not valid JSON, skip
    }
  }

  return events;
}

/**
 * Send a JSON-RPC message to the HTTP MCP server
 */
async function sendToServer(message) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };

  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }

  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
  });

  // Capture session ID from initialize response
  const newSessionId = response.headers.get('mcp-session-id');
  if (newSessionId) {
    sessionId = newSessionId;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  // 202 Accepted = notification acknowledged, no response body
  if (response.status === 202) {
    log(`202 Accepted (notification)`);
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  log(`Response status=${response.status}, content-type=${contentType}`);

  // Handle SSE response
  if (contentType.includes('text/event-stream')) {
    const text = await response.text();
    log(`SSE response (${text.length} bytes)`);
    const events = parseSSEEvents(text);
    log(`Parsed ${events.length} SSE events`);
    if (events.length > 0) {
      log(`Last event: ${JSON.stringify(events[events.length - 1])}`);
    }
    // Return the last event (the final response)
    // Earlier events may be progress notifications
    return events[events.length - 1] || null;
  }

  // Handle JSON response
  const text = await response.text();
  log(`JSON response (${text.length} bytes): ${text.substring(0, 200)}`);
  if (!text.trim()) {
    return null;
  }
  return JSON.parse(text);
}

/**
 * Write a JSON-RPC message to stdout
 */
function writeToStdout(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

/**
 * Log to stderr (doesn't interfere with JSON-RPC on stdout)
 */
function log(message) {
  process.stderr.write(`[bridge] ${message}\n`);
}

// Set up readline for stdin
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

log(`Starting stdio-http bridge to ${baseUrl}/mcp`);

rl.on('line', async (line) => {
  if (!line.trim()) return;

  try {
    const message = JSON.parse(line);
    const isNotification = message.id === undefined;

    try {
      log(`Sending: ${JSON.stringify(message)}`);
      const response = await sendToServer(message);
      // Only write response for requests (not notifications)
      if (response !== null) {
        log(`Writing to stdout: ${JSON.stringify(response)}`);
        writeToStdout(response);
      } else {
        log(`No response to write (notification)`);
      }
    } catch (error) {
      // Only send error response for requests (not notifications)
      if (!isNotification) {
        writeToStdout({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: error.message,
          },
          id: message.id,
        });
      }
      log(`Error: ${error.message}`);
    }
  } catch (parseError) {
    // Invalid JSON
    writeToStdout({
      jsonrpc: '2.0',
      error: {
        code: -32700,
        message: 'Parse error: Invalid JSON',
      },
      id: null,
    });
    log(`Parse error: ${parseError.message}`);
  }
});

rl.on('close', () => {
  log('stdin closed, exiting');
  process.exit(0);
});

// Handle process signals
process.on('SIGTERM', () => {
  log('Received SIGTERM, exiting');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('Received SIGINT, exiting');
  process.exit(0);
});
