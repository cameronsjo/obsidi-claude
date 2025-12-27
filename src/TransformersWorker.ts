/**
 * Manages a Web Worker for running Transformers.js embeddings
 *
 * Uses inline worker code with CDN loading to avoid bundling issues
 * in Obsidian's plugin environment.
 */

import { createLogger } from './Logger';

const log = createLogger('TransformersWorker');

// Worker response types
interface WorkerResponse {
  id: number;
  type: 'success' | 'error' | 'progress';
  payload?: {
    embeddings?: number[][];
    dimensions?: number;
    status?: string;
  };
  error?: string;
}

// Inline worker code that loads transformers.js from CDN
// Using @xenova/transformers v2.x with importScripts for classic worker compatibility
const WORKER_CODE = `
// Transformers.js CDN URL - UMD build for importScripts compatibility
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';

let extractor = null;
let modelName = 'Xenova/all-MiniLM-L6-v2';
let dimensions = 384;
let isLoading = false;
let transformersLoaded = false;

// Post progress to main thread
function postProgress(status) {
  self.postMessage({ id: -1, type: 'progress', payload: { status } });
}

// Load transformers.js using importScripts (works in classic workers)
function loadTransformers() {
  if (transformersLoaded) return;
  postProgress('Loading transformers.js from CDN...');
  importScripts(TRANSFORMERS_URL);
  transformersLoaded = true;
}

// Initialize embedding pipeline
async function initPipeline(model) {
  if (isLoading) throw new Error('Model is already loading');
  if (extractor && modelName === model) return; // Already loaded this model

  isLoading = true;
  modelName = model;

  try {
    loadTransformers();

    // Access the global Transformers object
    const { pipeline, env } = self.Transformers || self;

    // Configure for browser environment
    if (env) {
      env.allowLocalModels = false;
      env.useBrowserCache = true;
    }

    postProgress('Loading model: ' + model + '...');

    // Create the feature extraction pipeline
    extractor = await pipeline('feature-extraction', model, {
      quantized: true,
      progress_callback: (progress) => {
        if (progress.status === 'progress' && progress.total > 0) {
          const pct = Math.round((progress.loaded / progress.total) * 100);
          postProgress('Downloading model: ' + pct + '%');
        }
      }
    });

    // Set dimensions based on model
    if (model.includes('MiniLM-L6')) dimensions = 384;
    else if (model.includes('bge-small')) dimensions = 384;
    else if (model.includes('bge-base')) dimensions = 768;
    else dimensions = 384;

    postProgress('Model loaded successfully');
  } finally {
    isLoading = false;
  }
}

// Embed texts
async function embedTexts(texts) {
  if (!extractor) throw new Error('Pipeline not initialized');

  const results = [];
  for (let i = 0; i < texts.length; i++) {
    postProgress('Embedding ' + (i + 1) + '/' + texts.length + '...');
    const output = await extractor(texts[i], { pooling: 'mean', normalize: true });
    // output.data is a Float32Array, convert to regular array
    results.push(Array.from(output.data));
  }
  return results;
}

// Message handler
self.onmessage = async (event) => {
  const { id, type, payload } = event.data;

  try {
    switch (type) {
      case 'init': {
        await initPipeline(payload?.model || 'Xenova/all-MiniLM-L6-v2');
        self.postMessage({ id, type: 'success', payload: { dimensions, status: 'initialized' } });
        break;
      }
      case 'embed': {
        if (!payload?.texts?.length) throw new Error('No texts provided');
        const embeddings = await embedTexts(payload.texts);
        self.postMessage({ id, type: 'success', payload: { embeddings, dimensions } });
        break;
      }
      case 'status': {
        self.postMessage({
          id,
          type: 'success',
          payload: { status: extractor ? 'ready' : isLoading ? 'loading' : 'uninitialized', dimensions }
        });
        break;
      }
      default:
        throw new Error('Unknown message type: ' + type);
    }
  } catch (error) {
    const errMsg = error && error.message ? error.message : String(error);
    self.postMessage({ id, type: 'error', error: errMsg });
  }
};

self.postMessage({ id: -1, type: 'success', payload: { status: 'worker_ready' } });
`;

export class TransformersWorkerManager {
  private worker: Worker | null = null;
  private requestId = 0;
  private pendingRequests: Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private initialized = false;
  private modelName: string;
  private dimensions = 384;
  private onProgress?: (status: string) => void;

  constructor(modelName = 'Xenova/all-MiniLM-L6-v2', onProgress?: (status: string) => void) {
    this.modelName = modelName;
    this.onProgress = onProgress;
  }

  /**
   * Initialize the worker and load the model
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    log.info('Initializing transformers worker', { model: this.modelName });

    // Create classic worker from inline code (not module worker)
    // Classic workers support importScripts which we use to load transformers.js
    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);

    this.worker = new Worker(workerUrl);

    // Set up message handler
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.handleMessage(event.data);
    };

    this.worker.onerror = (error) => {
      log.error('Worker error', error);
    };

    // Wait for worker to be ready
    await this.waitForReady();

    // Initialize the model
    const result = await this.sendRequest('init', { model: this.modelName }) as { dimensions: number };
    this.dimensions = result.dimensions;
    this.initialized = true;

    log.info('Transformers worker initialized', { dimensions: this.dimensions });

    // Clean up blob URL
    URL.revokeObjectURL(workerUrl);
  }

  /**
   * Embed texts using the worker
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const result = await this.sendRequest('embed', { texts }) as { embeddings: number[][] };
    return result.embeddings;
  }

  /**
   * Get embedding dimensions
   */
  getDimensions(): number {
    return this.dimensions;
  }

  /**
   * Terminate the worker
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.initialized = false;
    }
  }

  private handleMessage(response: WorkerResponse): void {
    const { id, type, payload, error } = response;

    // Handle progress messages
    if (id === -1 && type === 'progress' && payload?.status) {
      log.debug('Worker progress', { status: payload.status });
      this.onProgress?.(payload.status);
      return;
    }

    // Handle worker ready signal
    if (id === -1 && payload?.status === 'worker_ready') {
      log.debug('Worker ready');
      return;
    }

    // Handle request responses
    const pending = this.pendingRequests.get(id);
    if (!pending) {
      log.warn('No pending request for response', { id });
      return;
    }

    this.pendingRequests.delete(id);

    if (type === 'error') {
      pending.reject(new Error(error || 'Unknown worker error'));
    } else {
      pending.resolve(payload);
    }
  }

  private sendRequest(type: string, payload?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }

      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });

      this.worker.postMessage({ id, type, payload });
    });
  }

  private waitForReady(): Promise<void> {
    return new Promise((resolve) => {
      // Give the worker a moment to initialize
      setTimeout(resolve, 100);
    });
  }
}
