import type { EmbeddingSettings } from './types';

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
  getName(): string;
}

/**
 * Local embeddings using Transformers.js (runs in-process with ONNX)
 * No external server required.
 * Note: Requires @xenova/transformers to be installed separately.
 */
export class TransformersJSProvider implements EmbeddingProvider {
  private pipeline: unknown;
  private dimensions: number;
  private modelName: string;
  private initialized = false;
  private initError: Error | null = null;

  constructor(modelName = 'Xenova/all-MiniLM-L6-v2') {
    this.modelName = modelName;
    // Dimensions vary by model
    this.dimensions = modelName.includes('MiniLM-L6') ? 384 : 768;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initError) throw this.initError;

    try {
      // Dynamic import to avoid bundling issues
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const transformers = await import('@xenova/transformers');
      const { pipeline } = transformers;
      this.pipeline = await pipeline('feature-extraction', this.modelName, {
        quantized: true,
      });
      this.initialized = true;
    } catch (error) {
      this.initError = new Error(
        `Transformers.js not available. Install it with: npm install @xenova/transformers\n` +
        `Or use a different embedding provider (Ollama, OpenAI, or Voyage AI).\n` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw this.initError;
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    await this.initialize();

    const results: number[][] = [];
    const extractor = this.pipeline as (
      text: string,
      options: { pooling: string; normalize: boolean }
    ) => Promise<{ data: Float32Array }>;

    for (const text of texts) {
      const output = await extractor(text, {
        pooling: 'mean',
        normalize: true,
      });
      results.push(Array.from(output.data));
    }

    return results;
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
  private settings: EmbeddingSettings;

  constructor(settings: EmbeddingSettings) {
    this.settings = settings;
  }

  updateSettings(settings: EmbeddingSettings): void {
    this.settings = settings;
    this.provider = null; // Reset provider on settings change
  }

  private getProvider(): EmbeddingProvider {
    if (this.provider) return this.provider;

    switch (this.settings.provider) {
      case 'ollama':
        this.provider = new OllamaProvider(
          this.settings.localModel || 'nomic-embed-text',
          this.settings.ollamaHost || 'http://localhost:11434'
        );
        break;
      case 'openai':
        if (!this.settings.openaiApiKey) {
          throw new Error('OpenAI API key is required');
        }
        this.provider = new OpenAIProvider(
          this.settings.openaiApiKey,
          this.settings.openaiModel || 'text-embedding-3-small',
          this.settings.openaiDimensions || 512
        );
        break;
      case 'voyage':
        if (!this.settings.voyageApiKey) {
          throw new Error('Voyage AI API key is required');
        }
        this.provider = new VoyageAIProvider(
          this.settings.voyageApiKey,
          this.settings.voyageModel || 'voyage-3-large'
        );
        break;
      default:
        throw new Error(`Unknown embedding provider: ${this.settings.provider}`);
    }

    return this.provider;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return this.getProvider().embed(texts);
  }

  async embedSingle(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    return results[0];
  }

  getDimensions(): number {
    return this.getProvider().getDimensions();
  }

  getProviderName(): string {
    return this.getProvider().getName();
  }

  isConfigured(): boolean {
    try {
      this.getProvider();
      return true;
    } catch {
      return false;
    }
  }
}
