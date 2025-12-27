# WebWorker + CDN Pattern for WASM Libraries in Obsidian Plugins

This document describes a pattern for using WASM-based libraries (like Transformers.js, ONNX Runtime) in Obsidian plugins, where traditional bundling approaches fail.

## The Problem

Obsidian plugins are bundled into a single JavaScript file using esbuild. This creates issues with WASM-based libraries:

1. **Dynamic imports fail** - `import('@xenova/transformers')` can't resolve in the bundled context
2. **Module specifiers break** - `Failed to resolve module specifier '@xenova/transformers'`
3. **WASM loading conflicts** - WASM binaries can't be loaded from the bundled code
4. **Bundle size explosion** - Libraries like transformers.js are 50MB+ when bundled

## The Solution: WebWorker + CDN Loading

Load the WASM library from a CDN at runtime, running in an isolated Web Worker:

```
┌─────────────────────────────────────────────────────────────┐
│  Obsidian Plugin (Main Thread)                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  TransformersWorkerManager                          │   │
│  │  - Creates worker from inline blob                  │   │
│  │  - Sends embed requests via postMessage             │   │
│  │  - Receives results via onmessage                   │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │ postMessage                       │
└─────────────────────────┼───────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────┐
│  Web Worker (Isolated)  ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Worker Code (Inline Blob)                          │   │
│  │  1. import('https://cdn.jsdelivr.net/npm/...')      │   │
│  │  2. pipeline = await transformers.pipeline(...)     │   │
│  │  3. embeddings = await pipeline(texts)              │   │
│  │  4. postMessage(results)                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  WASM/ONNX Runtime (Auto-loaded by transformers.js)        │
└─────────────────────────────────────────────────────────────┘
```

## Implementation

### 1. Create Inline Worker Code

The worker code is stored as a string and converted to a blob URL at runtime:

```typescript
const WORKER_CODE = `
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.1.2';

let pipeline = null;
let transformers = null;

async function loadTransformers() {
  if (transformers) return transformers;
  transformers = await import(TRANSFORMERS_CDN);
  return transformers;
}

async function initPipeline(model) {
  const tf = await loadTransformers();
  pipeline = await tf.pipeline('feature-extraction', model, { dtype: 'q8' });
}

async function embedTexts(texts) {
  const results = [];
  for (const text of texts) {
    const output = await pipeline(text, { pooling: 'mean', normalize: true });
    results.push(Array.from(output.data));
  }
  return results;
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data;
  try {
    if (type === 'init') {
      await initPipeline(payload.model);
      self.postMessage({ id, type: 'success' });
    } else if (type === 'embed') {
      const embeddings = await embedTexts(payload.texts);
      self.postMessage({ id, type: 'success', payload: { embeddings } });
    }
  } catch (error) {
    self.postMessage({ id, type: 'error', error: error.message });
  }
};
`;
```

### 2. Create Worker Manager

```typescript
export class TransformersWorkerManager {
  private worker: Worker | null = null;

  async initialize(): Promise<void> {
    // Create worker from inline code blob
    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);

    this.worker = new Worker(workerUrl, { type: 'module' });
    URL.revokeObjectURL(workerUrl);

    // Initialize the model
    await this.sendRequest('init', { model: 'Xenova/all-MiniLM-L6-v2' });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const result = await this.sendRequest('embed', { texts });
    return result.embeddings;
  }

  private sendRequest(type: string, payload: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = Date.now();
      const handler = (event: MessageEvent) => {
        if (event.data.id === id) {
          this.worker.removeEventListener('message', handler);
          if (event.data.type === 'error') reject(new Error(event.data.error));
          else resolve(event.data.payload);
        }
      };
      this.worker.addEventListener('message', handler);
      this.worker.postMessage({ id, type, payload });
    });
  }
}
```

### 3. Use in Provider

```typescript
export class TransformersJSProvider implements EmbeddingProvider {
  private worker: TransformersWorkerManager | null = null;

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.worker) {
      this.worker = new TransformersWorkerManager();
      await this.worker.initialize();
    }
    return this.worker.embed(texts);
  }
}
```

## Key Benefits

| Benefit | Description |
|---------|-------------|
| **No bundling required** | Library loads from CDN at runtime |
| **Isolated execution** | WASM runs in worker, can't conflict with Obsidian |
| **Lazy loading** | Model only downloads when first used |
| **Non-blocking** | Heavy computation in worker thread |
| **Auto-updates** | CDN always serves latest patch version |

## CDN Options

| CDN | URL Pattern | Notes |
|-----|-------------|-------|
| jsDelivr | `https://cdn.jsdelivr.net/npm/PKG@VERSION` | Most reliable, auto minification |
| unpkg | `https://unpkg.com/PKG@VERSION` | Fast, good fallback |
| Skypack | `https://cdn.skypack.dev/PKG@VERSION` | ESM optimized |

## Hardware Fallback Strategy

Transformers.js automatically handles hardware detection:

```
Priority Order:
1. WebGPU (if available) - GPU accelerated
2. WASM with SIMD - CPU optimized
3. WASM basic - Pure CPU fallback
```

## Caveats

1. **First-load latency** - Model downloads on first use (~22-110MB depending on model)
2. **Network required** - CDN must be reachable for first load (cached after)
3. **CSP restrictions** - Some environments block CDN imports
4. **Worker type** - Use `{ type: 'module' }` for dynamic import support

## References

- [Obsidian Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) - Production example
- [jsbrains/smart-embed](https://github.com/brianpetro/jsbrains) - Embedding abstraction layer
- [Transformers.js](https://huggingface.co/docs/transformers.js) - Official documentation
