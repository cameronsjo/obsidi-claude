# Iframe + CDN Pattern for WASM Libraries in Obsidian Plugins

> **See also:** [ADR-0001: Transformers.js in Obsidian via Iframe Isolation](./adr/0001-transformers-js-iframe-pattern.md) for the full story of how we arrived at this pattern, including all the failed attempts.

This document describes a pattern for using WASM-based libraries (like Transformers.js, ONNX Runtime) in Obsidian plugins, where traditional bundling approaches fail.

## The Problem

Obsidian plugins are bundled into a single JavaScript file using esbuild. This creates issues with WASM-based libraries:

1. **Dynamic imports fail** - `import('@xenova/transformers')` can't resolve in the bundled context
2. **Module specifiers break** - `Failed to resolve module specifier '@xenova/transformers'`
3. **WASM loading conflicts** - WASM binaries can't be loaded from the bundled code
4. **Bundle size explosion** - Libraries like transformers.js are 50MB+ when bundled
5. **Worker cross-origin restrictions** - `importScripts()` blocked for CDN URLs in Electron

## The Solution: Iframe + CDN Loading

Load the WASM library from a CDN at runtime, running in an isolated iframe:

```
┌─────────────────────────────────────────────────────────────┐
│  Obsidian Plugin (Main Thread)                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  TransformersIframeManager                          │   │
│  │  - Creates hidden iframe from blob URL              │   │
│  │  - Sends embed requests via postMessage             │   │
│  │  - Receives results via message event               │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │ postMessage                       │
└─────────────────────────┼───────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────┐
│  Hidden Iframe          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  <script type="module">                             │   │
│  │  1. import('https://cdn.jsdelivr.net/npm/...')      │   │
│  │  2. pipeline = await transformers.pipeline(...)     │   │
│  │  3. embeddings = await pipeline(texts)              │   │
│  │  4. parent.postMessage(results)                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  WASM/ONNX Runtime (Auto-loaded by transformers.js)        │
└─────────────────────────────────────────────────────────────┘
```

## Why Iframe Instead of Worker?

Web Workers in Obsidian's Electron environment have restrictions:

| Approach | Issue |
|----------|-------|
| Module Worker + dynamic import | `import()` from CDN blocked in worker context |
| Classic Worker + importScripts | `importScripts()` blocked for cross-origin URLs |
| Iframe + module script | **Works!** Iframes can load ESM from CDN |

The iframe approach is used by [obsidian-smart-connections](https://github.com/brianpetro/obsidian-smart-connections) and is the proven pattern for Obsidian.

## Implementation

### 1. Create Inline Iframe HTML

The iframe content is stored as an HTML string and converted to a blob URL at runtime:

```typescript
const IFRAME_HTML = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script type="module">
const { pipeline, env } = await import(
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.0'
);

env.allowLocalModels = false;
env.useBrowserCache = true;

let extractor = null;
let iframeId = null;

async function initPipeline(model) {
  extractor = await pipeline('feature-extraction', model, {
    dtype: 'q8',
    device: 'wasm'
  });
}

async function embedTexts(texts) {
  const results = [];
  for (const text of texts) {
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    results.push(Array.from(output.data));
  }
  return results;
}

window.addEventListener('message', async (event) => {
  const { id, iframeId: msgIframeId, type, payload } = event.data;
  if (msgIframeId) iframeId = msgIframeId;

  try {
    if (type === 'init') {
      await initPipeline(payload.model);
      parent.postMessage({ id, iframeId, type: 'success' }, '*');
    } else if (type === 'embed') {
      const embeddings = await embedTexts(payload.texts);
      parent.postMessage({ id, iframeId, type: 'success', payload: { embeddings } }, '*');
    }
  } catch (error) {
    parent.postMessage({ id, iframeId, type: 'error', error: error.message }, '*');
  }
});

parent.postMessage({ id: -1, iframeId, type: 'success', payload: { status: 'iframe_ready' } }, '*');
</script>
</body>
</html>
`;
```

### 2. Create Iframe Manager

```typescript
export class TransformersIframeManager {
  private iframe: HTMLIFrameElement | null = null;
  private iframeId: string;

  constructor() {
    this.iframeId = \`iframe-\${Date.now()}-\${Math.random().toString(36).slice(2)}\`;
  }

  async initialize(): Promise<void> {
    // Create hidden iframe
    this.iframe = document.createElement('iframe');
    this.iframe.style.cssText = 'position:absolute;width:0;height:0;border:none;visibility:hidden;';

    // Set up message handler
    window.addEventListener('message', this.handleMessage.bind(this));

    // Create blob URL and load
    const blob = new Blob([IFRAME_HTML], { type: 'text/html' });
    this.iframe.src = URL.createObjectURL(blob);
    document.body.appendChild(this.iframe);

    await this.waitForReady();
    await this.sendRequest('init', { model: 'Xenova/all-MiniLM-L6-v2' });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const result = await this.sendRequest('embed', { texts });
    return result.embeddings;
  }

  private sendRequest(type: string, payload: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = Date.now();
      // ... message handling with iframeId validation
      this.iframe.contentWindow.postMessage({ id, iframeId: this.iframeId, type, payload }, '*');
    });
  }
}
```

### 3. Use in Provider

```typescript
export class TransformersJSProvider implements EmbeddingProvider {
  private iframe: TransformersIframeManager | null = null;

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.iframe) {
      this.iframe = new TransformersIframeManager();
      await this.iframe.initialize();
    }
    return this.iframe.embed(texts);
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
3. **CSP restrictions** - Some environments may block CDN imports
4. **Main thread execution** - Unlike workers, iframes run on the main thread (though WASM is still efficient)

## References

- [Obsidian Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) - Production example
- [jsbrains/smart-embed](https://github.com/brianpetro/jsbrains) - Embedding abstraction layer
- [Transformers.js](https://huggingface.co/docs/transformers.js) - Official documentation
