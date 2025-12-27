import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EmbeddingService,
  TransformersJSProvider,
  OllamaProvider,
  OpenAIProvider,
  VoyageAIProvider,
} from '../src/EmbeddingService';
import type { EmbeddingSettings } from '../src/types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('EmbeddingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor and configuration', () => {
    it('should create service with settings', () => {
      const settings: EmbeddingSettings = {
        enabled: true,
        provider: 'ollama',
        chunkSize: 500,
        chunkOverlap: 50,
        excludeFolders: [],
      };
      const service = new EmbeddingService(settings);
      expect(service).toBeDefined();
    });

    it('should update settings', () => {
      const settings: EmbeddingSettings = {
        enabled: true,
        provider: 'ollama',
        chunkSize: 500,
        chunkOverlap: 50,
        excludeFolders: [],
      };
      const service = new EmbeddingService(settings);

      service.updateSettings({ ...settings, provider: 'openai', openaiApiKey: 'test-key' });
      // Provider should be reset on update (tested indirectly)
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe('provider selection', () => {
    it('should select transformers provider', () => {
      const settings: EmbeddingSettings = {
        enabled: true,
        provider: 'transformers',
        chunkSize: 500,
        chunkOverlap: 50,
        excludeFolders: [],
      };
      const service = new EmbeddingService(settings);
      expect(service.getProviderName()).toContain('transformers.js');
    });

    it('should select ollama provider', () => {
      const settings: EmbeddingSettings = {
        enabled: true,
        provider: 'ollama',
        localModel: 'nomic-embed-text',
        chunkSize: 500,
        chunkOverlap: 50,
        excludeFolders: [],
      };
      const service = new EmbeddingService(settings);
      expect(service.getProviderName()).toBe('ollama:nomic-embed-text');
    });

    it('should select openai provider', () => {
      const settings: EmbeddingSettings = {
        enabled: true,
        provider: 'openai',
        openaiApiKey: 'sk-test',
        chunkSize: 500,
        chunkOverlap: 50,
        excludeFolders: [],
      };
      const service = new EmbeddingService(settings);
      expect(service.getProviderName()).toContain('openai');
    });

    it('should select voyage provider', () => {
      const settings: EmbeddingSettings = {
        enabled: true,
        provider: 'voyage',
        voyageApiKey: 'voyage-test',
        chunkSize: 500,
        chunkOverlap: 50,
        excludeFolders: [],
      };
      const service = new EmbeddingService(settings);
      expect(service.getProviderName()).toContain('voyage');
    });

    it('should throw for unknown provider', () => {
      const settings: EmbeddingSettings = {
        enabled: true,
        provider: 'unknown' as any,
        chunkSize: 500,
        chunkOverlap: 50,
        excludeFolders: [],
      };
      const service = new EmbeddingService(settings);
      expect(() => service.getProviderName()).toThrow('Unknown embedding provider');
    });

    it('should throw when openai key is missing', () => {
      const settings: EmbeddingSettings = {
        enabled: true,
        provider: 'openai',
        chunkSize: 500,
        chunkOverlap: 50,
        excludeFolders: [],
      };
      const service = new EmbeddingService(settings);
      expect(() => service.getProviderName()).toThrow('OpenAI API key is required');
    });

    it('should throw when voyage key is missing', () => {
      const settings: EmbeddingSettings = {
        enabled: true,
        provider: 'voyage',
        chunkSize: 500,
        chunkOverlap: 50,
        excludeFolders: [],
      };
      const service = new EmbeddingService(settings);
      expect(() => service.getProviderName()).toThrow('Voyage AI API key is required');
    });
  });

  describe('isConfigured', () => {
    it('should return true for valid configuration', () => {
      const settings: EmbeddingSettings = {
        enabled: true,
        provider: 'ollama',
        chunkSize: 500,
        chunkOverlap: 50,
        excludeFolders: [],
      };
      const service = new EmbeddingService(settings);
      expect(service.isConfigured()).toBe(true);
    });

    it('should return false for invalid configuration', () => {
      const settings: EmbeddingSettings = {
        enabled: true,
        provider: 'openai', // Missing API key
        chunkSize: 500,
        chunkOverlap: 50,
        excludeFolders: [],
      };
      const service = new EmbeddingService(settings);
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('getDimensions', () => {
    it('should return dimensions for ollama with nomic', () => {
      const settings: EmbeddingSettings = {
        enabled: true,
        provider: 'ollama',
        localModel: 'nomic-embed-text',
        chunkSize: 500,
        chunkOverlap: 50,
        excludeFolders: [],
      };
      const service = new EmbeddingService(settings);
      expect(service.getDimensions()).toBe(768);
    });

    it('should return dimensions for openai', () => {
      const settings: EmbeddingSettings = {
        enabled: true,
        provider: 'openai',
        openaiApiKey: 'test',
        openaiDimensions: 1024,
        chunkSize: 500,
        chunkOverlap: 50,
        excludeFolders: [],
      };
      const service = new EmbeddingService(settings);
      expect(service.getDimensions()).toBe(1024);
    });

    it('should return default dimensions for openai', () => {
      const settings: EmbeddingSettings = {
        enabled: true,
        provider: 'openai',
        openaiApiKey: 'test',
        chunkSize: 500,
        chunkOverlap: 50,
        excludeFolders: [],
      };
      const service = new EmbeddingService(settings);
      expect(service.getDimensions()).toBe(512);
    });

    it('should return dimensions for voyage', () => {
      const settings: EmbeddingSettings = {
        enabled: true,
        provider: 'voyage',
        voyageApiKey: 'test',
        chunkSize: 500,
        chunkOverlap: 50,
        excludeFolders: [],
      };
      const service = new EmbeddingService(settings);
      expect(service.getDimensions()).toBe(1024);
    });
  });
});

describe('OllamaProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should embed texts', async () => {
    const mockEmbeddings = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embeddings: mockEmbeddings }),
    });

    const provider = new OllamaProvider('nomic-embed-text');
    const result = await provider.embed(['hello', 'world']);

    expect(result).toEqual(mockEmbeddings);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/embed',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'nomic-embed-text',
          input: ['hello', 'world'],
        }),
      })
    );
  });

  it('should throw on error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => 'Model not found',
    });

    const provider = new OllamaProvider('nomic-embed-text');
    await expect(provider.embed(['hello'])).rejects.toThrow('Ollama embedding failed');
  });

  it('should use custom host', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embeddings: [[0.1]] }),
    });

    const provider = new OllamaProvider('nomic-embed-text', 'http://custom:11434');
    await provider.embed(['hello']);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://custom:11434/api/embed',
      expect.any(Object)
    );
  });

  it('should return correct dimensions for nomic model', () => {
    const provider = new OllamaProvider('nomic-embed-text');
    expect(provider.getDimensions()).toBe(768);
  });

  it('should return correct dimensions for other models', () => {
    const provider = new OllamaProvider('mxbai-embed-large');
    expect(provider.getDimensions()).toBe(384);
  });

  it('should return correct name', () => {
    const provider = new OllamaProvider('nomic-embed-text');
    expect(provider.getName()).toBe('ollama:nomic-embed-text');
  });
});

describe('OpenAIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should embed texts', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [0.1, 0.2], index: 0 },
          { embedding: [0.3, 0.4], index: 1 },
        ],
      }),
    });

    const provider = new OpenAIProvider('sk-test');
    const result = await provider.embed(['hello', 'world']);

    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
        }),
      })
    );
  });

  it('should sort results by index', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [0.3, 0.4], index: 1 },
          { embedding: [0.1, 0.2], index: 0 },
        ],
      }),
    });

    const provider = new OpenAIProvider('sk-test');
    const result = await provider.embed(['hello', 'world']);

    // Should be sorted by index
    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it('should throw on error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => 'Invalid API key',
    });

    const provider = new OpenAIProvider('sk-invalid');
    await expect(provider.embed(['hello'])).rejects.toThrow('OpenAI embedding failed');
  });

  it('should use custom model and dimensions', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1], index: 0 }] }),
    });

    const provider = new OpenAIProvider('sk-test', 'text-embedding-3-large', 1024);
    await provider.embed(['hello']);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        body: expect.stringContaining('"model":"text-embedding-3-large"'),
      })
    );
    expect(provider.getDimensions()).toBe(1024);
  });

  it('should return correct name', () => {
    const provider = new OpenAIProvider('sk-test', 'text-embedding-3-small');
    expect(provider.getName()).toBe('openai:text-embedding-3-small');
  });
});

describe('VoyageAIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should embed texts', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
      }),
    });

    const provider = new VoyageAIProvider('voyage-key');
    const result = await provider.embed(['hello', 'world']);

    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.voyageai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer voyage-key',
        }),
      })
    );
  });

  it('should throw on error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => 'Rate limit exceeded',
    });

    const provider = new VoyageAIProvider('voyage-key');
    await expect(provider.embed(['hello'])).rejects.toThrow('Voyage AI embedding failed');
  });

  it('should return correct dimensions', () => {
    const provider = new VoyageAIProvider('voyage-key');
    expect(provider.getDimensions()).toBe(1024);
  });

  it('should return correct name', () => {
    const provider = new VoyageAIProvider('voyage-key', 'voyage-3');
    expect(provider.getName()).toBe('voyage:voyage-3');
  });

  it('should use document input type', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1] }] }),
    });

    const provider = new VoyageAIProvider('voyage-key');
    await provider.embed(['hello']);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.input_type).toBe('document');
  });
});

describe('TransformersJSProvider', () => {
  it('should return correct dimensions for MiniLM-L6 model', () => {
    const provider = new TransformersJSProvider('Xenova/all-MiniLM-L6-v2');
    expect(provider.getDimensions()).toBe(384);
  });

  it('should return correct dimensions for other models', () => {
    const provider = new TransformersJSProvider('Xenova/bge-base-en-v1.5');
    expect(provider.getDimensions()).toBe(768);
  });

  it('should return correct name', () => {
    const provider = new TransformersJSProvider('Xenova/all-MiniLM-L6-v2');
    expect(provider.getName()).toBe('transformers.js:Xenova/all-MiniLM-L6-v2');
  });

  it('should use default model', () => {
    const provider = new TransformersJSProvider();
    expect(provider.getName()).toBe('transformers.js:Xenova/all-MiniLM-L6-v2');
    expect(provider.getDimensions()).toBe(384);
  });
});

describe('EmbeddingService.embed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should embed single text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    });

    const settings: EmbeddingSettings = {
      enabled: true,
      provider: 'ollama',
      chunkSize: 500,
      chunkOverlap: 50,
      excludeFolders: [],
    };
    const service = new EmbeddingService(settings);
    const result = await service.embedSingle('hello');

    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it('should embed multiple texts', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embeddings: [[0.1], [0.2], [0.3]] }),
    });

    const settings: EmbeddingSettings = {
      enabled: true,
      provider: 'ollama',
      chunkSize: 500,
      chunkOverlap: 50,
      excludeFolders: [],
    };
    const service = new EmbeddingService(settings);
    const result = await service.embed(['a', 'b', 'c']);

    expect(result).toHaveLength(3);
  });
});
