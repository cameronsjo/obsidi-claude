import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { createLogger } from './Logger';

const log = createLogger('ClaudePath');

/**
 * Common installation paths for Claude CLI across platforms
 */
const COMMON_PATHS = [
  // macOS Homebrew
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  // Linux
  '/usr/bin/claude',
  '/usr/local/bin/claude',
  // npm global installs
  '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js',
  '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js',
];

/**
 * Attempts to find the Claude CLI executable path.
 * Checks in order:
 * 1. User-configured path (if provided)
 * 2. `which claude` command
 * 3. Common installation paths
 * 4. Bundled SDK CLI (fallback)
 */
export function findClaudeCliPath(configuredPath?: string): string | null {
  // 1. Use configured path if provided and valid
  if (configuredPath && existsSync(configuredPath)) {
    log.debug('Using configured Claude path', { path: configuredPath });
    return configuredPath;
  }

  // 2. Try `which claude`
  try {
    const whichResult = execSync('which claude', { encoding: 'utf-8' }).trim();
    if (whichResult && existsSync(whichResult)) {
      log.info('Found Claude CLI via which command', { path: whichResult });
      return whichResult;
    }
  } catch {
    log.debug('which claude command failed');
  }

  // 3. Check common installation paths
  for (const path of COMMON_PATHS) {
    if (existsSync(path)) {
      log.info('Found Claude CLI at common path', { path });
      return path;
    }
  }

  // 4. Check if SDK bundles a CLI
  const sdkCliPath = findSdkBundledCli();
  if (sdkCliPath) {
    log.info('Using SDK bundled CLI', { path: sdkCliPath });
    return sdkCliPath;
  }

  log.warn('Could not find Claude CLI');
  return null;
}

/**
 * Looks for the CLI bundled with the claude-agent-sdk package
 */
function findSdkBundledCli(): string | null {
  // Try to find relative to this module
  const possiblePaths = [
    // From plugin's node_modules
    join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'),
    // Obsidian plugins directory structure
    join(__dirname, '..', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

/**
 * Validates that a Claude CLI path is executable
 */
export function validateClaudeCliPath(path: string): { valid: boolean; error?: string } {
  if (!existsSync(path)) {
    return { valid: false, error: `File does not exist: ${path}` };
  }

  try {
    // Try to get version to verify it's actually Claude CLI
    const result = execSync(`"${path}" --version`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    if (result.includes('claude') || result.includes('Claude')) {
      log.debug('Claude CLI validated', { path, version: result });
      return { valid: true };
    }

    return { valid: false, error: `Not a Claude CLI: ${result}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, error: `Failed to execute: ${message}` };
  }
}
