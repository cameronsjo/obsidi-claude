import { existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { homedir, platform } from 'os';
import { createLogger } from './logger';

const log = createLogger('ClaudePath');

const isWindows = platform() === 'win32';

/**
 * Returns an enhanced PATH that includes common Node/Homebrew locations.
 * This is needed because Electron's PATH often doesn't include these directories.
 */
export function getEnhancedPath(): string {
  const currentPath = process.env.PATH || '';
  const home = homedir();
  const pathSep = isWindows ? ';' : ':';

  const additionalPaths = isWindows
    ? [
        join(process.env.APPDATA || '', 'npm'),
        join(home, 'scoop', 'shims'),
        'C:\\Program Files\\nodejs',
      ]
    : [
        '/opt/homebrew/bin', // macOS ARM Homebrew
        '/usr/local/bin', // macOS Intel Homebrew / Linux
        '/usr/bin',
        join(home, '.npm-global', 'bin'),
        join(home, '.local', 'bin'),
        join(home, 'bin'),
        // nvm paths
        join(home, '.nvm', 'versions', 'node', 'default', 'bin'),
        // fnm paths
        join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin'),
      ];

  // Add paths that exist and aren't already in PATH
  const pathsToAdd = additionalPaths.filter(
    (p) => existsSync(p) && !currentPath.includes(p)
  );

  if (pathsToAdd.length > 0) {
    log.debug('Enhancing PATH with additional directories', { count: pathsToAdd.length });
  }

  return [...pathsToAdd, currentPath].join(pathSep);
}

/**
 * Get common installation paths for Claude CLI across platforms
 * Dynamically includes home directory paths
 */
function getCommonPaths(): string[] {
  const home = homedir();

  if (isWindows) {
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');

    return [
      // npm global installs on Windows (most common)
      join(appData, 'npm', 'claude.cmd'),
      join(appData, 'npm', 'claude'),
      // Scoop installs
      join(home, 'scoop', 'shims', 'claude.cmd'),
      join(home, 'scoop', 'shims', 'claude.exe'),
      // Chocolatey
      join(process.env.ChocolateyInstall || 'C:\\ProgramData\\chocolatey', 'bin', 'claude.cmd'),
      // nvm-windows
      join(appData, 'nvm', '*', 'claude.cmd'),
      // fnm on Windows
      join(localAppData, 'fnm_multishells', '*', 'claude.cmd'),
      // Direct in PATH locations
      'C:\\Program Files\\nodejs\\claude.cmd',
      'C:\\Program Files (x86)\\nodejs\\claude.cmd',
    ];
  }

  // Unix-like systems (macOS, Linux)
  return [
    // User-local npm global installs (most common for npm -g)
    join(home, '.npm-global', 'bin', 'claude'),
    join(home, '.npm', 'bin', 'claude'),
    join(home, 'node_modules', '.bin', 'claude'),
    // User local bin
    join(home, '.local', 'bin', 'claude'),
    join(home, 'bin', 'claude'),
    // macOS Homebrew
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    // Linux
    '/usr/bin/claude',
    // npm global installs (system)
    '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js',
    '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js',
    join(home, '.npm-global', 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
  ];
}

/**
 * Attempts to find the Claude CLI executable path.
 * Checks in order:
 * 1. User-configured path (if provided)
 * 2. `which claude` command (may fail in Electron)
 * 3. Common installation paths (including home directory)
 * 4. Node version manager paths (nvm, fnm)
 * 5. Bundled SDK CLI (fallback)
 */
export function findClaudeCliPath(configuredPath?: string): string | null {
  log.debug('Starting Claude CLI path detection');

  // 1. Use configured path if provided and valid
  if (configuredPath && existsSync(configuredPath)) {
    log.info('Using configured Claude path', { path: configuredPath });
    return configuredPath;
  }

  // 2. Try `which`/`where` command - may fail in Electron due to limited PATH
  try {
    const whichCmd = isWindows ? 'where claude' : 'which claude';
    const whichResult = execSync(whichCmd, { encoding: 'utf-8', timeout: 3000 }).trim();
    // `where` on Windows can return multiple lines, take the first
    const firstResult = whichResult.split('\n')[0].trim();
    if (firstResult && existsSync(firstResult)) {
      log.info('Found Claude CLI via which/where command', { path: firstResult });
      return firstResult;
    }
  } catch {
    log.debug('which/where command failed (expected in Electron)');
  }

  // 3. Check common installation paths
  const commonPaths = getCommonPaths();
  for (const path of commonPaths) {
    // Skip paths with wildcards - we'll handle those separately
    if (path.includes('*')) continue;

    if (existsSync(path)) {
      log.info('Found Claude CLI at common path', { path });
      return path;
    }
  }

  // 4. Check node version manager directories (nvm, fnm)
  const nvmPath = findInNodeVersionManager();
  if (nvmPath) {
    log.info('Found Claude CLI in node version manager', { path: nvmPath });
    return nvmPath;
  }

  // 5. Check if SDK bundles a CLI
  const sdkCliPath = findSdkBundledCli();
  if (sdkCliPath) {
    log.info('Using SDK bundled CLI', { path: sdkCliPath });
    return sdkCliPath;
  }

  log.warn('Could not find Claude CLI - checked paths', {
    checkedCount: commonPaths.filter((p) => !p.includes('*')).length,
  });
  return null;
}

/**
 * Search for Claude CLI in node version manager directories (nvm, fnm)
 */
function findInNodeVersionManager(): string | null {
  const home = homedir();

  if (isWindows) {
    // nvm-windows: %APPDATA%\nvm\v*\claude.cmd
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    const nvmWinBase = join(appData, 'nvm');
    if (existsSync(nvmWinBase)) {
      try {
        const versions = readdirSync(nvmWinBase);
        for (const version of versions) {
          if (!version.startsWith('v')) continue;
          for (const ext of ['claude.cmd', 'claude.exe', 'claude']) {
            const claudePath = join(nvmWinBase, version, ext);
            if (existsSync(claudePath)) {
              return claudePath;
            }
          }
        }
      } catch {
        log.debug('Failed to read nvm-windows versions directory');
      }
    }

    // fnm on Windows: %LOCALAPPDATA%\fnm_multishells\*\claude.cmd
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    const fnmWinBase = join(localAppData, 'fnm_multishells');
    if (existsSync(fnmWinBase)) {
      try {
        const shells = readdirSync(fnmWinBase);
        for (const shell of shells) {
          for (const ext of ['claude.cmd', 'claude.exe', 'claude']) {
            const claudePath = join(fnmWinBase, shell, ext);
            if (existsSync(claudePath)) {
              return claudePath;
            }
          }
        }
      } catch {
        log.debug('Failed to read fnm-windows directory');
      }
    }
  } else {
    // Unix: nvm ~/.nvm/versions/node/*/bin/claude
    const nvmBase = join(home, '.nvm', 'versions', 'node');
    if (existsSync(nvmBase)) {
      try {
        const versions = readdirSync(nvmBase);
        for (const version of versions) {
          const claudePath = join(nvmBase, version, 'bin', 'claude');
          if (existsSync(claudePath)) {
            return claudePath;
          }
        }
      } catch {
        log.debug('Failed to read nvm versions directory');
      }
    }

    // fnm: ~/.local/share/fnm/node-versions/*/installation/bin/claude
    const fnmBase = join(home, '.local', 'share', 'fnm', 'node-versions');
    if (existsSync(fnmBase)) {
      try {
        const versions = readdirSync(fnmBase);
        for (const version of versions) {
          const claudePath = join(fnmBase, version, 'installation', 'bin', 'claude');
          if (existsSync(claudePath)) {
            return claudePath;
          }
        }
      } catch {
        log.debug('Failed to read fnm versions directory');
      }
    }
  }

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
