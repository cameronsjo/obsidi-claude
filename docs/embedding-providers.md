# Embedding Provider Comparison

This document compares the available embedding providers for semantic search in Obsidi-Claude.

## Provider Comparison Matrix

| Feature | Transformers.js | Ollama | OpenAI | Voyage AI |
|---------|-----------------|--------|--------|-----------|
| **Cost** | Free | Free | ~$0.02/1M tokens | ~$0.06-0.12/1M tokens |
| **Privacy** | 100% local | 100% local | Cloud (data sent) | Cloud (data sent) |
| **Setup** | None | Install Ollama | API key | API key |
| **First-load** | 22-110MB download | Model pull (~275MB) | Instant | Instant |
| **Speed** | ~50-200ms/embed | ~20-100ms/embed | ~100-300ms/embed | ~100-300ms/embed |
| **Quality** | Good | Good-Excellent | Excellent | Best-in-class |
| **Offline** | Yes (after first load) | Yes | No | No |
| **GPU Support** | WebGPU (if available) | CUDA/Metal | N/A | N/A |

## Model Details

### Transformers.js (In-Browser)

Runs entirely in your browser using WebAssembly. First use downloads the model from HuggingFace CDN.

| Model | Dimensions | Size | Quality | Speed |
|-------|------------|------|---------|-------|
| `Xenova/all-MiniLM-L6-v2` | 384 | 22MB | Good | Fastest |
| `Xenova/bge-small-en-v1.5` | 384 | 33MB | Better | Fast |
| `Xenova/bge-base-en-v1.5` | 768 | 110MB | Best | Slower |

**Pros:**
- Zero setup, works immediately
- No external services needed
- Completely private

**Cons:**
- First load downloads model (22-110MB)
- Slower than native code
- Limited to smaller models
- **May cause brief UI freezes** during indexing (runs on main thread)

> **⚠️ Performance Notice:** Transformers.js runs in your browser and may cause brief UI freezes during indexing. Recommended for small vaults (<500 files). For larger vaults, use Ollama instead (free, local, no UI blocking).

**How it works:** Transformers.js can't be bundled directly into Obsidian plugins due to WASM loading conflicts. We use an [iframe isolation pattern](./adr/0001-transformers-js-iframe-pattern.md) that loads the library from CDN at runtime in a hidden iframe. This approach is battle-tested by [obsidian-smart-connections](https://github.com/brianpetro/obsidian-smart-connections).

### Ollama (Local Server)

Runs on your machine via Ollama. Requires [Ollama](https://ollama.ai) installation.

| Model | Dimensions | Size | Quality | Speed |
|-------|------------|------|---------|-------|
| `nomic-embed-text` | 768 | 274MB | Excellent | Fast |
| `mxbai-embed-large` | 1024 | 670MB | Best | Medium |
| `all-minilm` | 384 | 45MB | Good | Fastest |

**Setup:**
```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull embedding model
ollama pull nomic-embed-text
```

**Pros:**
- Native speed (much faster than WASM)
- GPU acceleration (CUDA/Metal)
- Larger, higher-quality models
- 100% private

**Cons:**
- Requires Ollama installation
- Uses system resources
- Model download required

### OpenAI (Remote API)

Uses OpenAI's embedding API. Requires API key.

| Model | Dimensions | Max Tokens | Quality |
|-------|------------|------------|---------|
| `text-embedding-3-small` | 512-1536 | 8191 | Good |
| `text-embedding-3-large` | 256-3072 | 8191 | Excellent |
| `text-embedding-ada-002` | 1536 | 8191 | Good (legacy) |

**Pricing:** ~$0.02 per 1M tokens (3-small), ~$0.13 per 1M tokens (3-large)

**Pros:**
- No local resources needed
- Very high quality
- Instant start (no model download)
- Adjustable dimensions

**Cons:**
- Costs money
- Data sent to OpenAI servers
- Requires internet connection

### Voyage AI (Remote API)

Premium embedding service optimized for retrieval. Requires API key.

| Model | Dimensions | Max Tokens | Quality |
|-------|------------|------------|---------|
| `voyage-3-large` | 1024 | 32000 | Best-in-class |
| `voyage-3` | 1024 | 32000 | Excellent |
| `voyage-3-lite` | 512 | 32000 | Good |

**Pricing:** $0.06/1M tokens (lite) to $0.12/1M tokens (large)

**Pros:**
- Best retrieval quality
- Very long context (32K tokens)
- Optimized for RAG
- Multilingual support

**Cons:**
- Costs money
- Data sent to Voyage servers
- Requires internet connection

## Recommendation by Use Case

| Use Case | Recommended Provider | Reason |
|----------|---------------------|--------|
| **Quick start / Testing** | Transformers.js | No setup, just works |
| **Daily use / Privacy-focused** | Ollama | Fast, private, high quality |
| **Best quality / Budget available** | Voyage AI | Best retrieval performance |
| **Existing OpenAI integration** | OpenAI | Consolidate billing |
| **Large vault (10K+ notes)** | Ollama or OpenAI | Better speed at scale |
| **Offline use** | Ollama or Transformers.js | No internet required |

## Quality Benchmarks (MTEB Retrieval)

Approximate scores on MTEB retrieval benchmark (higher = better):

| Provider | Model | MTEB Score |
|----------|-------|------------|
| Voyage AI | voyage-3-large | ~67 |
| OpenAI | text-embedding-3-large | ~64 |
| Ollama | nomic-embed-text | ~62 |
| OpenAI | text-embedding-3-small | ~62 |
| Transformers.js | bge-base-en-v1.5 | ~53 |
| Transformers.js | all-MiniLM-L6-v2 | ~41 |

*Note: Benchmarks are approximate and vary by task. Real-world performance depends on your specific content.*

## Switching Providers

When you switch embedding providers, you should re-index your vault because:

1. Different models produce different vector dimensions
2. Embeddings from different models aren't comparable
3. Similarity scores will be incorrect with mixed embeddings

To re-index: Settings > Semantic Search > Re-index Vault
