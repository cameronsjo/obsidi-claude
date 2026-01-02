# ADR-0001: Transformers.js in Obsidian via Iframe Isolation

**Status:** Accepted & Verified Working
**Date:** 2024-12-27
**Authors:** Cameron, Claude

## Context

We wanted to offer free, private, zero-setup embeddings using [Transformers.js](https://huggingface.co/docs/transformers.js) in an Obsidian plugin. This library runs machine learning models entirely in the browser using WebAssembly/ONNX Runtime.

The problem: **Obsidian plugins are bundled into a single JavaScript file**, and WASM-based libraries really don't like that.

## The Journey of Pain

### Attempt 1: Direct Import (Failed)

```typescript
import { pipeline } from '@xenova/transformers';
```

**Result:** Bundle size exploded to 50MB+ and the bundled code couldn't resolve WASM binary paths.

### Attempt 2: Dynamic Import (Failed)

```typescript
const { pipeline } = await import('@xenova/transformers');
```

**Result:** `Failed to resolve module specifier '@xenova/transformers'` — the bundled environment has no concept of npm modules at runtime.

### Attempt 3: Web Worker with Module Import (Failed)

Create a module worker and use dynamic import from CDN:

```typescript
const worker = new Worker(blobUrl, { type: 'module' });

// Inside worker:
const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers');
```

**Result:** `import()` from CDN is blocked in Electron's worker context. The worker can't fetch external ES modules.

### Attempt 4: Classic Worker with importScripts (Failed)

Switch to a classic worker (not module) and use `importScripts()`:

```typescript
const worker = new Worker(blobUrl); // No { type: 'module' }

// Inside worker:
importScripts('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js');
```

**Result:** `Failed to execute 'importScripts' on 'WorkerGlobalScope': The script at '...' failed to load.`

Electron/Obsidian blocks cross-origin scripts in workers. Security feature, but it blocks our use case.

### Attempt 5: Iframe with Module Script (Success!)

Create a hidden iframe and load transformers.js via `<script type="module">`:

```typescript
const IFRAME_HTML = `
<!DOCTYPE html>
<html>
<body>
<script type="module">
const { pipeline } = await import(
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.0'
);
// ... handle messages, run embeddings
</script>
</body>
</html>
`;

const iframe = document.createElement('iframe');
iframe.src = URL.createObjectURL(new Blob([IFRAME_HTML], { type: 'text/html' }));
document.body.appendChild(iframe);
```

**Result:** IT WORKS!

## Why Iframe Works

| Context | `import()` from CDN | `importScripts()` from CDN |
|---------|---------------------|---------------------------|
| Main thread | ✅ Works | N/A |
| Module Worker | ❌ Blocked | N/A |
| Classic Worker | N/A | ❌ Blocked |
| **Iframe** | ✅ Works | ✅ Works |

Iframes have their own browsing context with full web capabilities. They're not subject to the same restrictions that Electron applies to workers. The iframe acts as a mini-browser inside Obsidian.

## The Solution

```
┌─────────────────────────────────────────────────────┐
│  Obsidian Plugin (Main Thread)                      │
│                                                     │
│  TransformersIframeManager                          │
│  ├─ Creates hidden iframe (0x0, invisible)          │
│  ├─ Sends requests via postMessage                  │
│  └─ Receives embeddings via message events          │
│                         │                           │
│                         │ postMessage               │
│                         ▼                           │
│  ┌─────────────────────────────────────────────┐   │
│  │  Hidden Iframe (blob URL)                   │   │
│  │                                             │   │
│  │  <script type="module">                     │   │
│  │    import { pipeline } from CDN             │   │
│  │    // Load model, generate embeddings       │   │
│  │    parent.postMessage(results)              │   │
│  │  </script>                                  │   │
│  │                                             │   │
│  │  WASM/ONNX Runtime (auto-loaded)            │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Implementation Details

### Iframe Creation

```typescript
const blob = new Blob([IFRAME_HTML], { type: 'text/html' });
const blobUrl = URL.createObjectURL(blob);

this.iframe = document.createElement('iframe');
this.iframe.style.cssText = 'position:absolute;width:0;height:0;border:none;visibility:hidden;';
this.iframe.src = blobUrl;
document.body.appendChild(this.iframe);
```

### Message Protocol

Each message includes a unique `iframeId` to handle multiple instances:

```typescript
// Request
{
  id: 42,
  iframeId: 'transformers-iframe-1703649600000-abc123',
  type: 'embed',
  payload: { texts: ['Hello world'] }
}

// Response
{
  id: 42,
  iframeId: 'transformers-iframe-1703649600000-abc123',
  type: 'success',
  payload: { embeddings: [[0.1, 0.2, ...]], dimensions: 384 }
}
```

### Critical: Lazy Loading Required

The iframe MUST send its ready signal **before** attempting to load transformers.js. Top-level `await` in module scripts will block silently if the import fails, causing a timeout.

```javascript
// WRONG - will timeout silently if CDN fails
const { pipeline } = await import('https://cdn.jsdelivr.net/...');
parent.postMessage({ status: 'iframe_ready' }, '*');  // Never reached!

// CORRECT - signal ready first, load lazily
parent.postMessage({ status: 'iframe_ready' }, '*');  // Immediate!

async function loadTransformers() {
  // Load on demand when init message received
  return await import('https://cdn.jsdelivr.net/...');
}
```

### Race Condition Prevention

Multiple concurrent indexing requests could create multiple iframes. We use promise locking:

```typescript
private async ensureInitialized(): Promise<void> {
  if (this.iframe) return;
  if (this.initPromise) {
    await this.initPromise;
    return;
  }
  this.initPromise = this.doInitialize();
  await this.initPromise;
}
```

## Prior Art

This pattern was discovered by studying [obsidian-smart-connections](https://github.com/brianpetro/obsidian-smart-connections) which uses the [jsbrains/smart-embed-model](https://github.com/brianpetro/jsbrains) library. Their `SmartEmbedTransformersIframeAdapter` uses the same approach.

## Trade-offs

### Pros

- **Zero setup** — Works out of the box, no installation required
- **Free** — No API keys, no costs
- **Private** — Everything runs locally (after model download)
- **Cross-platform** — Works on Windows, Mac, Linux, mobile

### Cons

- **First-load latency** — Model downloads from CDN on first use (22-110MB)
- **Main thread blocking** — Iframe runs on main thread; WASM execution can cause brief UI freezes during indexing (see mitigation below)
- **Network dependency** — Needs internet for first model download
- **Browser cache reliance** — Model cached in browser, not plugin data folder

### Main Thread Blocking Mitigation

The iframe approach means WASM execution happens on the main thread, which can cause UI freezes during intensive embedding operations. We mitigate this with:

1. **Yields between embeddings** — `await new Promise(r => setTimeout(r, 0))` between each text embedding
2. **Yield after model load** — 100ms delay after model initialization before first use
3. **Batch delays in RAGService** — Configurable `batchSize` (default: 10 files) and `batchDelayMs` (default: 100ms) to yield to the main thread periodically during vault indexing

**Recommendation:** For vaults with 500+ files, use Ollama instead. It runs as a separate process with no UI blocking.

## Alternatives Considered

1. **Pre-bundle the model** — Would make plugin 100MB+, against Obsidian guidelines
2. **Local WebSocket server** — Too complex, requires separate installation
3. **Native Node.js module** — Obsidian plugins don't have Node.js access
4. **WASM in main thread** — Bundling issues remain unsolved

## Decision

Use the iframe pattern for Transformers.js embeddings. It's a clever hack that works reliably, provides a great UX (zero setup), and follows the proven pattern from production plugins.

## Consequences

- Users get free, private embeddings with no setup
- First embedding request will be slow (model download)
- We depend on jsDelivr CDN availability
- Future Obsidian updates could potentially break this (though unlikely)

## References

- [Transformers.js Documentation](https://huggingface.co/docs/transformers.js)
- [obsidian-smart-connections](https://github.com/brianpetro/obsidian-smart-connections)
- [jsbrains smart-embed-model](https://github.com/brianpetro/jsbrains/tree/main/smart-embed-model)
- [@huggingface/transformers on npm](https://www.npmjs.com/package/@huggingface/transformers)
