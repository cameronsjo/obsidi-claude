import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { platform } from 'os';
import { createLogger } from '../logger';
import { getEnhancedPath } from '../claudePath';

const log = createLogger('CLIExecutor');

export interface CLIExecutorConfig {
  /** Path to obsidian CLI binary (empty = auto-detect) */
  binaryPath?: string;
  /** Command timeout in milliseconds */
  timeout: number;
  /** Vault name from app.vault.getName() */
  vaultName: string;
}

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Known locations for the Obsidian CLI binary.
 * The CLI ships with Obsidian v1.12+ (early access).
 */
function getDefaultBinaryPaths(): string[] {
  const os = platform();
  if (os === 'darwin') {
    return [
      '/Applications/Obsidian.app/Contents/MacOS/Obsidian',
      '/usr/local/bin/obsidian',
    ];
  }
  if (os === 'linux') {
    return [
      '/usr/local/bin/obsidian',
      '/usr/bin/obsidian',
    ];
  }
  // Windows — not supported for CLI bridge currently
  return [];
}

/** Allowed CLI commands — rejects anything not on this list */
const ALLOWED_COMMANDS = new Set([
  'version',
  'sync:status',
  'sync:history',
  'sync:read',
  'sync:restore',
  'diff',
  'history',
  'history:read',
]);

/** Allowed parameter keys — rejects unknown keys to prevent argument injection */
const ALLOWED_PARAM_KEYS = new Set([
  'path',
  'version',
  'from',
  'to',
]);

/**
 * Validate a parameter value. Rejects values that could be interpreted
 * as CLI flags or contain control characters.
 */
function validateParamValue(key: string, value: string): void {
  // Reject values starting with - (could be interpreted as flags)
  if (value.startsWith('-')) {
    throw new Error(`Invalid parameter value for '${key}': must not start with '-'`);
  }
  // Reject null bytes and other control characters (except newlines which are valid in paths on some systems)
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    throw new Error(`Invalid parameter value for '${key}': contains control characters`);
  }
  // Reject unreasonably long values (path traversal amplification)
  if (value.length > 1024) {
    throw new Error(`Invalid parameter value for '${key}': exceeds maximum length (1024)`);
  }
}

/**
 * Low-level wrapper around the Obsidian CLI binary.
 *
 * Uses `child_process.execFile` (NOT `exec`) to avoid shell interpolation —
 * all arguments are passed as an array, preventing command injection.
 *
 * Additional security layers:
 * - Command allowlist: only known CLI commands are accepted
 * - Parameter key allowlist: only known parameter names are accepted
 * - Value validation: rejects flag-like values, control chars, and overlong strings
 *
 * Every command gets `vault=<name>` prepended automatically.
 */
export class CLIExecutor {
  private config: CLIExecutorConfig;
  private resolvedBinaryPath: string | null = null;
  private _isAvailable = false;

  constructor(config: CLIExecutorConfig) {
    this.config = config;
  }

  /**
   * Detect the CLI binary and validate with `obsidian version`.
   * Returns true if the CLI is usable.
   */
  async initialize(): Promise<boolean> {
    log.info('Initializing CLI executor', { vaultName: this.config.vaultName });

    // Resolve binary path
    this.resolvedBinaryPath = this.resolveBinaryPath();
    if (!this.resolvedBinaryPath) {
      log.warn('Obsidian CLI binary not found');
      this._isAvailable = false;
      return false;
    }

    // Validate by running `obsidian version`
    try {
      const result = await this.executeRaw(['version']);
      if (result.exitCode !== 0) {
        log.warn('Obsidian CLI version check failed', { stderr: result.stderr, exitCode: result.exitCode });
        this._isAvailable = false;
        return false;
      }

      log.info('Obsidian CLI available', {
        path: this.resolvedBinaryPath,
        version: result.stdout.trim(),
      });
      this._isAvailable = true;
      return true;
    } catch (error) {
      log.warn('Obsidian CLI validation failed', { error: error instanceof Error ? error.message : String(error) });
      this._isAvailable = false;
      return false;
    }
  }

  /** Whether the CLI was successfully initialized */
  get isAvailable(): boolean {
    return this._isAvailable;
  }

  /**
   * Execute an Obsidian CLI command.
   *
   * @param command - CLI command (e.g., 'sync:history', 'diff')
   * @param params - Key-value params (e.g., \{ path: 'notes/foo.md', version: '3' \})
   * @param flags - Positional flags (rare)
   */
  async execute(
    command: string,
    params?: Record<string, string>,
    flags?: string[]
  ): Promise<CLIResult> {
    if (!this._isAvailable || !this.resolvedBinaryPath) {
      throw new Error('CLI executor not initialized or unavailable');
    }

    // Validate command against allowlist
    if (!ALLOWED_COMMANDS.has(command)) {
      throw new Error(`Blocked CLI command: '${command}' is not in the allowed command list`);
    }

    // Validate and sanitize parameters
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (!ALLOWED_PARAM_KEYS.has(key)) {
          throw new Error(`Blocked CLI parameter key: '${key}' is not in the allowed parameter list`);
        }
        validateParamValue(key, value);
      }
    }

    // Build args: vault=<name> <command> key=value ...
    const args: string[] = [
      `vault=${this.config.vaultName}`,
      command,
    ];

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        args.push(`${key}=${value}`);
      }
    }

    if (flags) {
      args.push(...flags);
    }

    log.debug('Executing CLI command', { command, args });
    return this.executeRaw(args);
  }

  /**
   * Execute a CLI command and parse stdout as JSON.
   */
  async executeJson<T>(
    command: string,
    params?: Record<string, string>
  ): Promise<T> {
    const result = await this.execute(command, params);

    if (result.exitCode !== 0) {
      throw new Error(`CLI command '${command}' failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
    }

    try {
      return JSON.parse(result.stdout) as T;
    } catch {
      throw new Error(`CLI command '${command}' returned non-JSON output: ${result.stdout.slice(0, 200)}`);
    }
  }

  /**
   * Execute raw args against the CLI binary.
   * Uses execFile — args passed as array, no shell, no injection risk.
   */
  private executeRaw(args: string[]): Promise<CLIResult> {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        PATH: getEnhancedPath(),
      };

      // execFile is used intentionally — it does NOT spawn a shell,
      // so arguments cannot be interpreted as shell metacharacters.
      execFile(
        this.resolvedBinaryPath!,
        args,
        {
          timeout: this.config.timeout,
          env,
          maxBuffer: 10 * 1024 * 1024, // 10MB
        },
        (error, stdout, stderr) => {
          if (error && !('code' in error)) {
            // Non-exit-code error (timeout, signal, etc.)
            reject(error);
            return;
          }

          resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            exitCode: error
              ? (typeof (error as { code?: unknown }).code === 'number'
                ? (error as { code: number }).code
                : 1)
              : 0,
          });
        }
      );
    });
  }

  /** Resolve the CLI binary path: configured > auto-detect > PATH */
  private resolveBinaryPath(): string | null {
    // 1. User-configured path
    if (this.config.binaryPath && existsSync(this.config.binaryPath)) {
      log.debug('Using configured binary path', { path: this.config.binaryPath });
      return this.config.binaryPath;
    }

    // 2. Known default locations
    for (const path of getDefaultBinaryPaths()) {
      if (existsSync(path)) {
        log.debug('Found binary at default path', { path });
        return path;
      }
    }

    // 3. Fall back to bare 'obsidian' and let PATH resolve it
    // (execFile will throw if not found, handled gracefully by initialize())
    log.debug('Falling back to PATH resolution for obsidian binary');
    return 'obsidian';
  }
}
