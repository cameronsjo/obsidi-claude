import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger, createLogger, type LogLevel } from '../src/Logger';

describe('Logger', () => {
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset logger state
    Logger.setEnabled(true);
    Logger.setMinLevel('debug');

    // Spy on console methods
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createLogger', () => {
    it('should create a logger instance', () => {
      const log = createLogger('TestComponent');
      expect(log).toBeInstanceOf(Logger);
    });
  });

  describe('log levels', () => {
    it('should log debug messages', () => {
      const log = createLogger('Test');
      log.debug('Test action');

      expect(consoleDebugSpy).toHaveBeenCalled();
      const message = consoleDebugSpy.mock.calls[0][0] as string;
      expect(message).toContain('[Test]');
      expect(message).toContain('Test action');
    });

    it('should log info messages', () => {
      const log = createLogger('Test');
      log.info('Test action');

      expect(consoleInfoSpy).toHaveBeenCalled();
      const message = consoleInfoSpy.mock.calls[0][0] as string;
      expect(message).toContain('[Test]');
      expect(message).toContain('Test action');
    });

    it('should log warning messages', () => {
      const log = createLogger('Test');
      log.warn('Test warning');

      expect(consoleWarnSpy).toHaveBeenCalled();
      const message = consoleWarnSpy.mock.calls[0][0] as string;
      expect(message).toContain('[Test]');
      expect(message).toContain('Test warning');
    });

    it('should log error messages', () => {
      const log = createLogger('Test');
      log.error('Test error');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const message = consoleErrorSpy.mock.calls[0][0] as string;
      expect(message).toContain('[Test]');
      expect(message).toContain('Test error');
    });
  });

  describe('context formatting', () => {
    it('should include context in log message', () => {
      const log = createLogger('Test');
      log.info('Action', { count: 10, status: 'active' });

      const message = consoleInfoSpy.mock.calls[0][0] as string;
      expect(message).toContain('count=10');
      expect(message).toContain('status="active"');
    });

    it('should format string values with quotes', () => {
      const log = createLogger('Test');
      log.info('Action', { name: 'test' });

      const message = consoleInfoSpy.mock.calls[0][0] as string;
      expect(message).toContain('name="test"');
    });

    it('should format number values', () => {
      const log = createLogger('Test');
      log.info('Action', { count: 42 });

      const message = consoleInfoSpy.mock.calls[0][0] as string;
      expect(message).toContain('count=42');
    });

    it('should format boolean values', () => {
      const log = createLogger('Test');
      log.info('Action', { enabled: true, disabled: false });

      const message = consoleInfoSpy.mock.calls[0][0] as string;
      expect(message).toContain('enabled=true');
      expect(message).toContain('disabled=false');
    });

    it('should format null and undefined', () => {
      const log = createLogger('Test');
      log.info('Action', { nothing: null, missing: undefined });

      const message = consoleInfoSpy.mock.calls[0][0] as string;
      expect(message).toContain('nothing=null');
      expect(message).toContain('missing=undefined');
    });

    it('should format arrays as item count', () => {
      const log = createLogger('Test');
      log.info('Action', { items: [1, 2, 3, 4, 5] });

      const message = consoleInfoSpy.mock.calls[0][0] as string;
      expect(message).toContain('items=[5 items]');
    });

    it('should format objects as key count', () => {
      const log = createLogger('Test');
      log.info('Action', { config: { a: 1, b: 2, c: 3 } });

      const message = consoleInfoSpy.mock.calls[0][0] as string;
      expect(message).toContain('config={3 keys}');
    });

    it('should not include context braces when no context', () => {
      const log = createLogger('Test');
      log.info('Simple action');

      const message = consoleInfoSpy.mock.calls[0][0] as string;
      expect(message).not.toContain('{');
    });
  });

  describe('error handling', () => {
    it('should log Error objects', () => {
      const log = createLogger('Test');
      const error = new Error('Something went wrong');
      log.error('Operation failed', error);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Operation failed'),
        error
      );
    });

    it('should handle non-Error error values', () => {
      const log = createLogger('Test');
      log.error('Operation failed', 'string error');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Operation failed'),
        'string error'
      );
    });

    it('should handle error with context', () => {
      const log = createLogger('Test');
      const error = new Error('Test error');
      log.error('Operation failed', error, { userId: 123 });

      const message = consoleErrorSpy.mock.calls[0][0] as string;
      expect(message).toContain('userId=123');
    });

    it('should handle error without error parameter', () => {
      const log = createLogger('Test');
      log.error('Simple error message');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Simple error message')
      );
    });
  });

  describe('setEnabled', () => {
    it('should disable all logging when set to false', () => {
      const log = createLogger('Test');
      Logger.setEnabled(false);

      log.debug('Debug');
      log.info('Info');
      log.warn('Warn');
      log.error('Error');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should re-enable logging when set to true', () => {
      const log = createLogger('Test');
      Logger.setEnabled(false);
      Logger.setEnabled(true);

      log.info('Test');

      expect(consoleInfoSpy).toHaveBeenCalled();
    });
  });

  describe('setMinLevel', () => {
    it('should filter out debug when min level is info', () => {
      const log = createLogger('Test');
      Logger.setMinLevel('info');

      log.debug('Debug message');
      log.info('Info message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleInfoSpy).toHaveBeenCalled();
    });

    it('should filter out debug and info when min level is warn', () => {
      const log = createLogger('Test');
      Logger.setMinLevel('warn');

      log.debug('Debug');
      log.info('Info');
      log.warn('Warn');
      log.error('Error');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should only allow error when min level is error', () => {
      const log = createLogger('Test');
      Logger.setMinLevel('error');

      log.debug('Debug');
      log.info('Info');
      log.warn('Warn');
      log.error('Error');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('child', () => {
    it('should create a child logger with combined component name', () => {
      const log = createLogger('Parent');
      const childLog = log.child('Child');

      childLog.info('Child action');

      const message = consoleInfoSpy.mock.calls[0][0] as string;
      expect(message).toContain('[Parent:Child]');
    });

    it('should support multiple levels of nesting', () => {
      const log = createLogger('A');
      const child = log.child('B').child('C');

      child.info('Deep action');

      const message = consoleInfoSpy.mock.calls[0][0] as string;
      expect(message).toContain('[A:B:C]');
    });
  });

  describe('time', () => {
    it('should log start and completion of timed operation', async () => {
      const log = createLogger('Test');

      const result = await log.time('Operation', async () => {
        await new Promise((r) => setTimeout(r, 10));
        return 'success';
      });

      expect(result).toBe('success');
      expect(consoleDebugSpy).toHaveBeenCalled();
      expect(consoleInfoSpy).toHaveBeenCalled();

      const startMessage = consoleDebugSpy.mock.calls[0][0] as string;
      expect(startMessage).toContain('Operation started');

      const endMessage = consoleInfoSpy.mock.calls[0][0] as string;
      expect(endMessage).toContain('Operation completed');
      expect(endMessage).toContain('durationMs=');
    });

    it('should log error and rethrow on failure', async () => {
      const log = createLogger('Test');
      const error = new Error('Test failure');

      await expect(
        log.time('Failing operation', async () => {
          throw error;
        })
      ).rejects.toThrow('Test failure');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorMessage = consoleErrorSpy.mock.calls[0][0] as string;
      expect(errorMessage).toContain('Failing operation failed');
      expect(errorMessage).toContain('durationMs=');
    });

    it('should include context in timed logs', async () => {
      const log = createLogger('Test');

      await log.time(
        'Operation',
        async () => 'done',
        { fileCount: 5 }
      );

      const startMessage = consoleDebugSpy.mock.calls[0][0] as string;
      expect(startMessage).toContain('fileCount=5');

      const endMessage = consoleInfoSpy.mock.calls[0][0] as string;
      expect(endMessage).toContain('fileCount=5');
    });
  });

  describe('timestamp format', () => {
    it('should include ISO timestamp', () => {
      const log = createLogger('Test');
      log.info('Test');

      const message = consoleInfoSpy.mock.calls[0][0] as string;
      // ISO timestamp format: YYYY-MM-DDTHH:MM:SS.sssZ
      expect(message).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });
  });
});
