/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createVoiceInput,
  type VoiceInputHandle,
  type VoiceInputCallbacks,
} from '../../src/chatView/voiceInput';

// Mock Obsidian logger
vi.mock('../../src/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock SpeechRecognition instance that we'll use to verify interactions
let mockRecognitionInstance: MockSpeechRecognition;

// Mock SpeechRecognition class
class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null;
  onend: (() => void) | null = null;

  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    mockRecognitionInstance = this;
  }
}

describe('VoiceInput', () => {
  let callbacks: VoiceInputCallbacks;
  let handle: VoiceInputHandle;

  beforeEach(() => {
    callbacks = {
      onTranscript: vi.fn(),
      onError: vi.fn(),
      onStateChange: vi.fn(),
    };

    // Set up mock SpeechRecognition - assign the class itself (not an instance)
    (window as unknown as { SpeechRecognition: typeof SpeechRecognition }).SpeechRecognition =
      MockSpeechRecognition as unknown as typeof SpeechRecognition;
  });

  afterEach(() => {
    handle?.destroy();
    delete (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition;
    delete (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;
  });

  describe('availability', () => {
    it('should report available when SpeechRecognition exists', () => {
      handle = createVoiceInput(callbacks);
      expect(handle.isAvailable()).toBe(true);
    });

    it('should report available when webkitSpeechRecognition exists', () => {
      delete (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition;
      (window as unknown as { webkitSpeechRecognition: typeof SpeechRecognition }).webkitSpeechRecognition =
        vi.fn(() => mockRecognition) as unknown as typeof SpeechRecognition;

      handle = createVoiceInput(callbacks);
      expect(handle.isAvailable()).toBe(true);
    });

    it('should report unavailable when no SpeechRecognition API exists', () => {
      delete (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition;

      handle = createVoiceInput(callbacks);
      expect(handle.isAvailable()).toBe(false);
    });
  });

  describe('recording state', () => {
    it('should start not recording', () => {
      handle = createVoiceInput(callbacks);
      expect(handle.isRecording()).toBe(false);
    });

    it('should report recording after start', () => {
      handle = createVoiceInput(callbacks);
      handle.start();
      expect(handle.isRecording()).toBe(true);
    });

    it('should report not recording after stop', () => {
      handle = createVoiceInput(callbacks);
      handle.start();
      handle.stop();
      expect(handle.isRecording()).toBe(false);
    });

    it('should call onStateChange with true when starting', () => {
      handle = createVoiceInput(callbacks);
      handle.start();
      expect(callbacks.onStateChange).toHaveBeenCalledWith(true);
    });

    it('should call onStateChange with false when stopping', () => {
      handle = createVoiceInput(callbacks);
      handle.start();
      handle.stop();
      expect(callbacks.onStateChange).toHaveBeenCalledWith(false);
    });
  });

  describe('toggle', () => {
    it('should start recording when not recording', () => {
      handle = createVoiceInput(callbacks);
      handle.toggle();
      expect(handle.isRecording()).toBe(true);
    });

    it('should stop recording when already recording', () => {
      handle = createVoiceInput(callbacks);
      handle.start();
      handle.toggle();
      expect(handle.isRecording()).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should call onError when SpeechRecognition not available', () => {
      delete (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition;

      handle = createVoiceInput(callbacks);
      handle.start();

      expect(callbacks.onError).toHaveBeenCalledWith('Voice input not supported in this browser');
      expect(handle.isRecording()).toBe(false);
    });

    it('should call onError with denied message for not-allowed error', () => {
      handle = createVoiceInput(callbacks);
      handle.start();

      // Simulate error
      const errorEvent = { error: 'not-allowed' } as SpeechRecognitionErrorEvent;
      mockRecognitionInstance.onerror?.(errorEvent);

      expect(callbacks.onError).toHaveBeenCalledWith('Microphone access denied');
      expect(handle.isRecording()).toBe(false);
    });

    it('should call onError with generic message for other errors', () => {
      handle = createVoiceInput(callbacks);
      handle.start();

      // Simulate error
      const errorEvent = { error: 'network' } as SpeechRecognitionErrorEvent;
      mockRecognitionInstance.onerror?.(errorEvent);

      expect(callbacks.onError).toHaveBeenCalledWith('Voice error: network');
    });

    it('should stop recording when error occurs', () => {
      handle = createVoiceInput(callbacks);
      handle.start();

      const errorEvent = { error: 'aborted' } as SpeechRecognitionErrorEvent;
      mockRecognitionInstance.onerror?.(errorEvent);

      expect(handle.isRecording()).toBe(false);
      expect(callbacks.onStateChange).toHaveBeenLastCalledWith(false);
    });
  });

  describe('recognition configuration', () => {
    it('should configure continuous mode', () => {
      handle = createVoiceInput(callbacks);
      handle.start();
      expect(mockRecognitionInstance.continuous).toBe(true);
    });

    it('should configure interim results', () => {
      handle = createVoiceInput(callbacks);
      handle.start();
      expect(mockRecognitionInstance.interimResults).toBe(true);
    });

    it('should configure language to en-US', () => {
      handle = createVoiceInput(callbacks);
      handle.start();
      expect(mockRecognitionInstance.lang).toBe('en-US');
    });

    it('should call recognition.start()', () => {
      handle = createVoiceInput(callbacks);
      handle.start();
      expect(mockRecognitionInstance.start).toHaveBeenCalled();
    });

    it('should call recognition.stop() on stop', () => {
      handle = createVoiceInput(callbacks);
      handle.start();
      handle.stop();
      expect(mockRecognitionInstance.stop).toHaveBeenCalled();
    });
  });

  describe('transcript handling', () => {
    it('should call onTranscript with final results', () => {
      handle = createVoiceInput(callbacks);
      handle.start();

      // Simulate final result
      const resultEvent = {
        resultIndex: 0,
        results: [
          {
            0: { transcript: 'hello world' },
            isFinal: true,
            length: 1,
          },
        ],
      } as unknown as SpeechRecognitionEvent;

      mockRecognitionInstance.onresult?.(resultEvent);

      expect(callbacks.onTranscript).toHaveBeenCalledWith('hello world');
    });

    it('should call onTranscript with interim results', () => {
      handle = createVoiceInput(callbacks);
      handle.start();

      // Simulate interim result
      const resultEvent = {
        resultIndex: 0,
        results: [
          {
            0: { transcript: 'hello' },
            isFinal: false,
            length: 1,
          },
        ],
      } as unknown as SpeechRecognitionEvent;

      mockRecognitionInstance.onresult?.(resultEvent);

      expect(callbacks.onTranscript).toHaveBeenCalledWith(' hello');
    });

    it('should combine final and interim results', () => {
      handle = createVoiceInput(callbacks);
      handle.start();

      // Simulate final result
      const finalEvent = {
        resultIndex: 0,
        results: [
          {
            0: { transcript: 'hello' },
            isFinal: true,
            length: 1,
          },
        ],
      } as unknown as SpeechRecognitionEvent;

      mockRecognitionInstance.onresult?.(finalEvent);

      // Simulate additional interim result
      const interimEvent = {
        resultIndex: 1,
        results: [
          {
            0: { transcript: 'hello' },
            isFinal: true,
            length: 1,
          },
          {
            0: { transcript: 'world' },
            isFinal: false,
            length: 1,
          },
        ],
      } as unknown as SpeechRecognitionEvent;

      mockRecognitionInstance.onresult?.(interimEvent);

      expect(callbacks.onTranscript).toHaveBeenLastCalledWith('hello world');
    });
  });

  describe('recognition end handling', () => {
    it('should stop recording when recognition ends unexpectedly', () => {
      handle = createVoiceInput(callbacks);
      handle.start();

      // Simulate recognition ending
      mockRecognitionInstance.onend?.();

      expect(handle.isRecording()).toBe(false);
      expect(callbacks.onStateChange).toHaveBeenLastCalledWith(false);
    });

    it('should not double-call stop if already stopped', () => {
      handle = createVoiceInput(callbacks);
      handle.start();
      handle.stop();

      // Clear mock counts
      vi.mocked(callbacks.onStateChange).mockClear();

      // Simulate recognition ending after manual stop
      mockRecognitionInstance.onend?.();

      // Should not trigger another state change since already stopped
      expect(callbacks.onStateChange).not.toHaveBeenCalled();
    });
  });

  describe('destruction', () => {
    it('should stop recording on destroy', () => {
      handle = createVoiceInput(callbacks);
      handle.start();
      handle.destroy();

      expect(handle.isRecording()).toBe(false);
      expect(mockRecognitionInstance.stop).toHaveBeenCalled();
    });

    it('should handle destroy when not recording', () => {
      handle = createVoiceInput(callbacks);
      expect(() => handle.destroy()).not.toThrow();
    });
  });

  describe('start failure handling', () => {
    it('should call onError when start throws', () => {
      // Create a mock class where start() throws
      class FailingMockSpeechRecognition {
        continuous = false;
        interimResults = false;
        lang = '';
        onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
        onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null;
        onend: (() => void) | null = null;

        start(): void {
          throw new Error('Failed to start');
        }
        stop = vi.fn();
        abort = vi.fn();
      }

      (window as unknown as { SpeechRecognition: typeof SpeechRecognition }).SpeechRecognition =
        FailingMockSpeechRecognition as unknown as typeof SpeechRecognition;

      handle = createVoiceInput(callbacks);
      handle.start();

      expect(callbacks.onError).toHaveBeenCalledWith('Failed to start voice input');
    });
  });
});
