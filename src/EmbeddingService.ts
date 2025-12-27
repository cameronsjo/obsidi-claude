import type { EmbeddingSettings } from './types';
import { TransformersWorkerManager } from './TransformersWorker';

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
  getName(): string;
}

/**
 * Local embeddings using Transformers.js via Web Worker
 *
 * Loads @huggingface/transformers from CDN and runs in an isolated
 * Web Worker to avoid bundling/WASM conflicts with Obsidian.
 *
 * Pattern: WebWorker + CDN loading for WASM-based libraries
 * - Worker code is inlined as a blob URL
 * - Transformers.js is loaded from jsDelivr CDN at runtime
 * - WASM/ONNX runtime runs in worker thread, isolated from main thread
 */
export class TransformersJSProvider implements EmbeddingProvider {
  private worker: TransformersWorkerManager | null = null;
  private initPromise: Promise<void> | null = null;
  private dimensions: number;
  private modelName: string;

  constructor(modelName = 'Xenova/all-MiniLM-L6-v2') {
    this.modelName = modelName;
    // Dimensions vary by model
    this.dimensions = modelName.includes('MiniLM-L6') ? 384 : 768;
  }

  private async ensureInitialized(): Promise<void> {
    // If already initialized, return immediately
    if (this.worker) {
      return;
    }

    // If initialization is in progress, wait for it
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    // Start initialization - set promise FIRST to prevent race condition
    this.initPromise = (async () => {
      const worker = new TransformersWorkerManager(this.modelName);
      await worker.initialize();
      this.dimensions = worker.getDimensions();
      this.worker = worker; // Set worker LAST after fully initialized
    })();

    await this.initPromise;
  }

  async embed(texts: string[]): Promise<number[][]> {
    await this.ensureInitialized();
    return this.worker!.embed(texts);
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getName(): string {
    return `transformers.js:${this.modelName}`;
  }
}

/**
 * Local embeddings using Ollama server
 * Requires Ollama running on localhost:11434
 */
export class OllamaProvider implements EmbeddingProvider {
  private host: string;
  private model: string;
  private dimensions: number;

  constructor(model = 'nomic-embed-text', host = 'http://localhost:11434') {
    this.model = model;
    this.host = host;
    // Dimensions vary by model
    this.dimensions = model.includes('nomic') ? 768 : 384;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.host}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama embedding failed: ${error}`);
    }

    const result = (await response.json()) as { embeddings: number[][] };
    return result.embeddings;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getName(): string {
    return `ollama:${this.model}`;
  }
}

/**
 * Remote embeddings using OpenAI API
 */
export class OpenAIProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private dimensions: number;

  constructor(
    apiKey: string,
    model = 'text-embedding-3-small',
    dimensions = 512
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding failed: ${error}`);
    }

    const result = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to maintain order
    return result.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getName(): string {
    return `openai:${this.model}`;
  }
}

/**
 * Remote embeddings using Voyage AI
 */
export class VoyageAIProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private dimensions: number;

  constructor(apiKey: string, model = 'voyage-3-large') {
    this.apiKey = apiKey;
    this.model = model;
    // voyage-3-large is 1024 dims, voyage-3 is 1024 dims
    this.dimensions = 1024;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        input_type: 'document',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Voyage AI embedding failed: ${error}`);
    }

    const result = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    return result.data.map((item) => item.embedding);
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getName(): string {
    return `voyage:${this.model}`;
  }
}

/**
 * Factory to create embedding providers from settings
 */
export class EmbeddingService {
  private provider: EmbeddingProvider | null = null;
  private providerPromise: Promise<EmbeddingProvider> | null = null;
  private settings: EmbeddingSettings;

  constructor(settings: EmbeddingSettings) {
    this.settings = settings;
  }

  updateSettings(settings: EmbeddingSettings): void {
    this.settings = settings;
    this.provider = null; // Reset provider on settings change
    this.providerPromise = null;
  }

  private createProvider(): EmbeddingProvider {
    switch (this.settings.provider) {
      case 'transformers':
        return new TransformersJSProvider(
          this.settings.localModel || 'Xenova/all-MiniLM-L6-v2'
        );
      case 'ollama':
        return new OllamaProvider(
          this.settings.localModel || 'nomic-embed-text',
          this.settings.ollamaHost || 'http://localhost:11434'
        );
      case 'openai':
        if (!this.settings.openaiApiKey) {
          throw new Error('OpenAI API key is required');
        }
        return new OpenAIProvider(
          this.settings.openaiApiKey,
          this.settings.openaiModel || 'text-embedding-3-small',
          this.settings.openaiDimensions || 512
        );
      case 'voyage':
        if (!this.settings.voyageApiKey) {
          throw new Error('Voyage AI API key is required');
        }
        return new VoyageAIProvider(
          this.settings.voyageApiKey,
          this.settings.voyageModel || 'voyage-3-large'
        );
      default:
        throw new Error(`Unknown embedding provider: ${this.settings.provider}`);
    }
  }

  private getProviderSync(): EmbeddingProvider {
    if (!this.provider) {
      this.provider = this.createProvider();
    }
    return this.provider;
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Use synchronous provider creation to avoid race conditions
    // The provider itself handles async initialization internally
    return this.getProviderSync().embed(texts);
  }

  async embedSingle(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    return results[0];
  }

  getDimensions(): number {
    return this.getProviderSync().getDimensions();
  }

  getProviderName(): string {
    return this.getProviderSync().getName();
  }

  isConfigured(): boolean {
    try {
      this.getProviderSync();
      return true;
    } catch {
      return false;
    }
  }
}
