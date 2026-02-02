/**
 * Voice input module for ChatView.
 * Handles speech recognition for voice-to-text input.
 */
import type { ModuleHandle } from './types';
import { createLogger } from '../logger';

const log = createLogger('VoiceInput');

/**
 * Web Speech API type declarations.
 * These are not included in TypeScript's lib.dom.d.ts by default.
 */
interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

/**
 * Callbacks for voice input to communicate with parent.
 */
export interface VoiceInputCallbacks {
  onTranscript: (text: string) => void;
  onError: (error: string) => void;
  onStateChange: (recording: boolean) => void;
}

/**
 * Handle for controlling voice input.
 */
export interface VoiceInputHandle extends ModuleHandle {
  isAvailable(): boolean;
  isRecording(): boolean;
  start(): void;
  stop(): void;
  toggle(): void;
}

/**
 * Get the SpeechRecognition API, handling browser prefixes.
 */
function getSpeechRecognitionAPI(): SpeechRecognitionConstructor | null {
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

/**
 * Create voice input handler for speech-to-text functionality.
 * @param callbacks - Callbacks for parent communication
 */
export function createVoiceInput(
  callbacks: VoiceInputCallbacks
): VoiceInputHandle {
  let speechRecognition: SpeechRecognition | null = null;
  let recording = false;
  let currentTranscript = '';

  function isAvailable(): boolean {
    return getSpeechRecognitionAPI() !== null;
  }

  function isRecording(): boolean {
    return recording;
  }

  function start(): void {
    const SpeechRecognitionAPI = getSpeechRecognitionAPI();

    if (!SpeechRecognitionAPI) {
      callbacks.onError('Voice input not supported in this browser');
      return;
    }

    speechRecognition = new SpeechRecognitionAPI();
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    speechRecognition.lang = 'en-US';

    let finalTranscript = currentTranscript;
    let interimTranscript = '';

    speechRecognition.onresult = (event: SpeechRecognitionEvent): void => {
      interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += (finalTranscript ? ' ' : '') + transcript;
        } else {
          interimTranscript += transcript;
        }
      }
      // Report combined final + interim transcript
      const combined = finalTranscript + (interimTranscript ? ' ' + interimTranscript : '');
      callbacks.onTranscript(combined);
    };

    speechRecognition.onerror = (event: SpeechRecognitionErrorEvent): void => {
      log.error('Speech recognition error', { error: event.error });
      stop();
      if (event.error === 'not-allowed') {
        callbacks.onError('Microphone access denied');
      } else {
        callbacks.onError(`Voice error: ${event.error}`);
      }
    };

    speechRecognition.onend = (): void => {
      // Auto-stop UI if recognition ends unexpectedly
      if (recording) {
        stop();
      }
    };

    try {
      speechRecognition.start();
      recording = true;
      callbacks.onStateChange(true);
      log.info('Voice input started');
    } catch (error) {
      log.error('Failed to start voice input', error);
      callbacks.onError('Failed to start voice input');
    }
  }

  function stop(): void {
    if (speechRecognition) {
      speechRecognition.stop();
      speechRecognition = null;
    }
    recording = false;
    currentTranscript = '';
    callbacks.onStateChange(false);
    log.info('Voice input stopped');
  }

  function toggle(): void {
    if (recording) {
      stop();
    } else {
      start();
    }
  }

  function destroy(): void {
    stop();
  }

  return {
    isAvailable,
    isRecording,
    start,
    stop,
    toggle,
    destroy,
  };
}
