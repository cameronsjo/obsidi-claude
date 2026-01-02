/**
 * Manages an iframe for running Transformers.js embeddings
 *
 * Uses srcdoc iframe with dynamic import from CDN.
 * Runs on main thread but yields periodically to keep UI responsive.
 *
 * Why iframe? It's the only approach that works in Obsidian:
 * - Direct bundling: WASM loading fails
 * - Web Workers: Cross-origin restrictions block CDN imports
 * - Module workers from blobs: Don't work in Electron
 * - Iframe with srcdoc: CAN do dynamic imports from CDN
 */

import { createLogger } from './Logger';

const log = createLogger('TransformersIframe');

interface IframeResponse {
  id: number;
  type: 'success' | 'error' | 'progress';
  payload?: {
    embeddings?: number[][];
    dimensions?: number;
    status?: string;
  };
  error?: string;
}

// Iframe HTML with embedded module script
// Uses srcdoc which allows module scripts with dynamic imports
const IFRAME_SRCDOC = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script type="module">
let transformers = null;
let extractor = null;
let modelName = '';
let dimensions = 384;
let isLoading = false;

function post(msg) {
  parent.postMessage(msg, '*');
}

function progress(status) {
  post({ id: -1, type: 'progress', payload: { status } });
}

async function loadTransformers() {
  if (transformers) return;
  progress('Loading transformers.js from CDN...');
  try {
    transformers = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.0');
    if (transformers.env) {
      transformers.env.allowLocalModels = false;
      // Only enable browser cache if available (may not be in sandboxed contexts)
      try {
        if (typeof caches !== 'undefined') {
          transformers.env.useBrowserCache = true;
        }
      } catch (e) {
        // Cache API not available, skip
      }
    }
    progress('Transformers.js loaded');
  } catch (e) {
    post({ id: -1, type: 'error', error: 'CDN load failed: ' + e.message });
    throw e;
  }
}

async function initPipeline(model) {
  if (isLoading) throw new Error('Already loading');
  if (extractor && modelName === model) return { dimensions };

  isLoading = true;
  modelName = model;

  try {
    await loadTransformers();
    progress('Loading model: ' + model);

    extractor = await transformers.pipeline('feature-extraction', model, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total > 0) {
          progress('Downloading: ' + Math.round(p.loaded / p.total * 100) + '%');
        }
      }
    });

    dimensions = model.includes('MiniLM-L6') ? 384 :
                 model.includes('bge-small') ? 384 :
                 model.includes('bge-base') ? 768 : 384;

    progress('Model ready, warming up...');
    // Yield to main thread before first use
    await new Promise(r => setTimeout(r, 100));
    return { dimensions };
  } finally {
    isLoading = false;
  }
}

async function embed(texts) {
  if (!extractor) throw new Error('Not initialized');
  const results = [];
  for (let i = 0; i < texts.length; i++) {
    // Yield to main thread between embeddings
    await new Promise(r => setTimeout(r, 0));
    progress('Embedding ' + (i+1) + '/' + texts.length);
    const out = await extractor(texts[i], { pooling: 'mean', normalize: true });
    results.push(Array.from(out.data));
  }
  return results;
}

window.addEventListener('message', async (e) => {
  const { id, type, payload } = e.data || {};
  if (!type) return;

  try {
    if (type === 'init') {
      const r = await initPipeline(payload?.model || 'Xenova/all-MiniLM-L6-v2');
      post({ id, type: 'success', payload: { dimensions: r.dimensions, status: 'initialized' } });
    } else if (type === 'embed') {
      const embeddings = await embed(payload?.texts || []);
      post({ id, type: 'success', payload: { embeddings, dimensions } });
    }
  } catch (err) {
    post({ id, type: 'error', error: err.message || String(err) });
  }
});

post({ id: -1, type: 'success', payload: { status: 'iframe_ready' } });
</script>
</body>
</html>`;

export class TransformersIframeManager {
  private iframe: HTMLIFrameElement | null = null;
  private requestId = 0;
  private pendingRequests: Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private initialized = false;
  private modelName: string;
  private dimensions = 384;
  private onProgress?: (status: string) => void;
  private messageHandler: ((event: MessageEvent) => void) | null = null;

  constructor(modelName = 'Xenova/all-MiniLM-L6-v2', onProgress?: (status: string) => void) {
    this.modelName = modelName;
    this.onProgress = onProgress;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    log.info('Initializing transformers iframe', { model: this.modelName });

    // Create hidden iframe with srcdoc
    // Need allow-scripts for JS and allow-same-origin for Cache API access
    this.iframe = document.createElement('iframe');
    this.iframe.style.cssText = 'position:absolute;width:0;height:0;border:none;visibility:hidden;';
    this.iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');

    // Set up message handler
    this.messageHandler = (event: MessageEvent) => this.handleMessage(event.data);
    window.addEventListener('message', this.messageHandler);

    // Use srcdoc for inline HTML with module script
    this.iframe.srcdoc = IFRAME_SRCDOC;
    document.body.appendChild(this.iframe);

    // Wait for ready
    await this.waitForReady();

    // Init model
    const result = await this.sendRequest('init', { model: this.modelName }) as { dimensions: number };
    this.dimensions = result.dimensions;
    this.initialized = true;

    log.info('Transformers iframe initialized', { dimensions: this.dimensions });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.initialized) await this.initialize();
    const result = await this.sendRequest('embed', { texts }) as { embeddings: number[][] };
    return result.embeddings;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  destroy(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    this.initialized = false;
    this.pendingRequests.clear();
  }

  private handleMessage(response: IframeResponse): void {
    if (!response || typeof response !== 'object') return;
    const { id, type, payload, error } = response;

    if (id === -1 && type === 'progress' && payload?.status) {
      log.debug('Progress', { status: payload.status });
      this.onProgress?.(payload.status);
      return;
    }

    if (id === -1 && type === 'error' && error) {
      log.error('Iframe error', { error });
      return;
    }

    const pending = this.pendingRequests.get(id);
    if (!pending) return;

    this.pendingRequests.delete(id);
    if (type === 'error') {
      pending.reject(new Error(error || 'Unknown error'));
    } else {
      pending.resolve(payload);
    }
  }

  private sendRequest(type: string, payload?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.iframe?.contentWindow) {
        reject(new Error('Iframe not ready'));
        return;
      }
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });
      this.iframe.contentWindow.postMessage({ id, type, payload }, '*');
    });
  }

  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Iframe timeout')), 30000);

      const check = (event: MessageEvent) => {
        if (event.data?.payload?.status === 'iframe_ready') {
          clearTimeout(timeout);
          window.removeEventListener('message', check);
          setTimeout(resolve, 100);
        }
      };
      window.addEventListener('message', check);
    });
  }
}
