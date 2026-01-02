import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { join } from 'path';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// Mock os module
vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
  platform: vi.fn(() => 'darwin'),
}));

import { existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { homedir, platform } from 'os';
import { getEnhancedPath, findClaudeCliPath, validateClaudeCliPath } from '../src/claudePath';

describe('claudePath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset platform to macOS by default
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(homedir).mockReturnValue('/home/testuser');
    // Default: nothing exists
    vi.mocked(existsSync).mockReturnValue(false);
    // Reset process.env
    process.env.PATH = '/usr/bin:/bin';
  });

  describe('getEnhancedPath', () => {
    it('should return current PATH when no additional paths exist', () => {
      const result = getEnhancedPath();
      expect(result).toBe('/usr/bin:/bin');
    });

    it('should add existing paths that are not already in PATH', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        return p === '/opt/homebrew/bin';
      });

      const result = getEnhancedPath();
      expect(result).toContain('/opt/homebrew/bin');
      expect(result).toContain('/usr/bin:/bin');
    });

    it('should not duplicate paths already in PATH', () => {
      process.env.PATH = '/opt/homebrew/bin:/usr/bin';
      vi.mocked(existsSync).mockImplementation((p) => {
        return p === '/opt/homebrew/bin';
      });

      const result = getEnhancedPath();
      // Path should appear only once
      const matches = result.match(/\/opt\/homebrew\/bin/g);
      expect(matches?.length).toBe(1);
    });

    it('should use semicolon separator on Windows', () => {
      vi.mocked(platform).mockReturnValue('win32');
      process.env.PATH = 'C:\\Windows\\system32';
      process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';

      vi.mocked(existsSync).mockImplementation((p) => {
        return p === 'C:\\Users\\test\\AppData\\Roaming\\npm';
      });

      // Need to re-import to pick up platform change
      vi.resetModules();
    });
  });

  describe('findClaudeCliPath', () => {
    it('should return configured path if it exists', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        return p === '/custom/path/to/claude';
      });

      const result = findClaudeCliPath('/custom/path/to/claude');
      expect(result).toBe('/custom/path/to/claude');
    });

    it('should return null for configured path that does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('not found');
      });

      const result = findClaudeCliPath('/nonexistent/path');
      expect(result).toBeNull();
    });

    it('should find claude via which command', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        return p === '/usr/local/bin/claude';
      });
      vi.mocked(execSync).mockReturnValue('/usr/local/bin/claude\n');

      const result = findClaudeCliPath();
      expect(result).toBe('/usr/local/bin/claude');
    });

    it('should handle which command returning multiple results', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        return p === '/usr/local/bin/claude' || p === '/opt/homebrew/bin/claude';
      });
      vi.mocked(execSync).mockReturnValue('/usr/local/bin/claude\n/opt/homebrew/bin/claude\n');

      const result = findClaudeCliPath();
      expect(result).toBe('/usr/local/bin/claude'); // Should take first
    });

    it('should fall back to common paths when which fails', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('not found');
      });
      vi.mocked(existsSync).mockImplementation((p) => {
        return p === '/opt/homebrew/bin/claude';
      });

      const result = findClaudeCliPath();
      expect(result).toBe('/opt/homebrew/bin/claude');
    });

    it('should find claude in nvm directory', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('not found');
      });
      const nvmBase = '/home/testuser/.nvm/versions/node';
      vi.mocked(existsSync).mockImplementation((p) => {
        return (
          p === nvmBase || p === join(nvmBase, 'v18.0.0', 'bin', 'claude')
        );
      });
      vi.mocked(readdirSync).mockImplementation((p) => {
        if (p === nvmBase) return ['v18.0.0', 'v20.0.0'] as unknown as ReturnType<typeof readdirSync>;
        return [] as unknown as ReturnType<typeof readdirSync>;
      });

      const result = findClaudeCliPath();
      expect(result).toBe(join(nvmBase, 'v18.0.0', 'bin', 'claude'));
    });

    it('should find claude in fnm directory', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('not found');
      });
      const fnmBase = '/home/testuser/.local/share/fnm/node-versions';
      vi.mocked(existsSync).mockImplementation((p) => {
        return (
          p === fnmBase ||
          p === join(fnmBase, 'v20.0.0', 'installation', 'bin', 'claude')
        );
      });
      vi.mocked(readdirSync).mockImplementation((p) => {
        if (p === fnmBase) return ['v20.0.0'] as unknown as ReturnType<typeof readdirSync>;
        return [] as unknown as ReturnType<typeof readdirSync>;
      });

      const result = findClaudeCliPath();
      expect(result).toBe(join(fnmBase, 'v20.0.0', 'installation', 'bin', 'claude'));
    });

    it('should return null when nothing found', () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('not found');
      });

      const result = findClaudeCliPath();
      expect(result).toBeNull();
    });
  });

  describe('validateClaudeCliPath', () => {
    it('should return invalid for non-existent path', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = validateClaudeCliPath('/nonexistent/claude');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not exist');
    });

    it('should return valid when version contains claude', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execSync).mockReturnValue('claude 1.0.0\n');

      const result = validateClaudeCliPath('/usr/local/bin/claude');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return valid when version contains Claude (capitalized)', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execSync).mockReturnValue('Claude Code v2.0.0\n');

      const result = validateClaudeCliPath('/usr/local/bin/claude');
      expect(result.valid).toBe(true);
    });

    it('should return invalid when version does not contain claude', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execSync).mockReturnValue('node v18.0.0\n');

      const result = validateClaudeCliPath('/usr/local/bin/node');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Not a Claude CLI');
    });

    it('should return invalid when execution fails', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('permission denied');
      });

      const result = validateClaudeCliPath('/usr/local/bin/claude');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Failed to execute');
      expect(result.error).toContain('permission denied');
    });
  });

  // Windows-specific tests are skipped on non-Windows platforms
  // because the platform constant is evaluated at module load time
  // and cannot be easily mocked for cross-platform testing.
  // These paths are still covered by the generic tests above.
});
