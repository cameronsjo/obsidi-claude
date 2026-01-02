/**
 * Test setup file - mocks browser globals not available in Node.js
 */
import { vi } from 'vitest';

// Vector search entry type (matching VectorStore)
interface VectorEntry {
  id: string;
  filepath: string;
  chunkIndex: number;
  content: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

// Compute cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Mock Worker class that simulates the VectorSearchWorker
class MockWorker {
  private messageHandler: ((e: { data: unknown }) => void) | null = null;
  private entries: VectorEntry[] = [];

  constructor(url: string | URL) {
    // Send worker_ready message after a tick
    setTimeout(() => {
      this.sendMessage({ id: -1, type: 'success', payload: { status: 'worker_ready' } });
    }, 0);
  }

  private sendMessage(data: unknown): void {
    if (this.messageHandler) {
      this.messageHandler({ data });
    }
  }

  postMessage(data: unknown): void {
    if (typeof data !== 'object' || data === null) return;

    const msg = data as { id: number; type: string; payload?: Record<string, unknown> };
    const { id, type, payload = {} } = msg;

    // Process message asynchronously
    setTimeout(() => {
      try {
        switch (type) {
          case 'setEntries': {
            this.entries = (payload.entries as VectorEntry[]) || [];
            this.sendMessage({
              id,
              type: 'success',
              payload: { count: this.entries.length, status: 'entries_loaded' },
            });
            break;
          }

          case 'addEntries': {
            const newEntries = (payload.entries as VectorEntry[]) || [];
            for (const entry of newEntries) {
              const idx = this.entries.findIndex(
                (e) => e.filepath === entry.filepath && e.chunkIndex === entry.chunkIndex
              );
              if (idx >= 0) {
                this.entries[idx] = entry;
              } else {
                this.entries.push(entry);
              }
            }
            this.sendMessage({
              id,
              type: 'success',
              payload: { count: this.entries.length, status: 'entries_added' },
            });
            break;
          }

          case 'removeByFilepath': {
            const filepath = payload.filepath as string;
            this.entries = this.entries.filter((e) => e.filepath !== filepath);
            this.sendMessage({
              id,
              type: 'success',
              payload: { count: this.entries.length, status: 'entries_removed' },
            });
            break;
          }

          case 'clear': {
            this.entries = [];
            this.sendMessage({
              id,
              type: 'success',
              payload: { count: 0, status: 'cleared' },
            });
            break;
          }

          case 'search': {
            const queryVector = payload.queryVector as number[];
            const limit = (payload.limit as number) || 10;
            const minScore = (payload.minScore as number) || 0;

            const results = this.entries
              .map((entry) => ({
                document: {
                  id: entry.id,
                  filepath: entry.filepath,
                  chunkIndex: entry.chunkIndex,
                  content: entry.content,
                  metadata: entry.metadata,
                },
                score: cosineSimilarity(queryVector, entry.vector),
              }))
              .filter((r) => r.score >= minScore)
              .sort((a, b) => b.score - a.score)
              .slice(0, limit);

            this.sendMessage({
              id,
              type: 'success',
              payload: { results },
            });
            break;
          }

          case 'searchWithFilter': {
            const queryVector = payload.queryVector as number[];
            const filter = payload.filter as { includeTags?: string[] } | undefined;
            const limit = (payload.limit as number) || 10;
            const minScore = (payload.minScore as number) || 0;

            let filtered = this.entries;
            if (filter?.includeTags?.length) {
              filtered = filtered.filter((e) => {
                const tags = (e.metadata?.tags as string[]) || [];
                return filter.includeTags!.some((t) => tags.includes(t));
              });
            }

            const results = filtered
              .map((entry) => ({
                document: {
                  id: entry.id,
                  filepath: entry.filepath,
                  chunkIndex: entry.chunkIndex,
                  content: entry.content,
                  metadata: entry.metadata,
                },
                score: cosineSimilarity(queryVector, entry.vector),
              }))
              .filter((r) => r.score >= minScore)
              .sort((a, b) => b.score - a.score)
              .slice(0, limit);

            this.sendMessage({
              id,
              type: 'success',
              payload: { results },
            });
            break;
          }

          case 'getCount': {
            this.sendMessage({
              id,
              type: 'success',
              payload: { count: this.entries.length },
            });
            break;
          }

          default:
            this.sendMessage({
              id,
              type: 'error',
              error: 'Unknown message type: ' + type,
            });
        }
      } catch (error) {
        this.sendMessage({
          id,
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 0);
  }

  set onmessage(handler: ((e: { data: unknown }) => void) | null) {
    this.messageHandler = handler;
  }

  get onmessage(): ((e: { data: unknown }) => void) | null {
    return this.messageHandler;
  }

  terminate(): void {
    this.messageHandler = null;
    this.entries = [];
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.messageHandler = listener as unknown as (e: { data: unknown }) => void;
    }
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.messageHandler = null;
    }
  }
}

// Mock URL.createObjectURL and URL.revokeObjectURL
const mockObjectURLs = new Map<string, Blob>();
let urlCounter = 0;

const originalURL = globalThis.URL;

class MockURL extends originalURL {
  static createObjectURL(blob: Blob): string {
    const url = `blob:mock-${++urlCounter}`;
    mockObjectURLs.set(url, blob);
    return url;
  }

  static revokeObjectURL(url: string): void {
    mockObjectURLs.delete(url);
  }
}

// Mock Blob
class MockBlob implements Blob {
  private parts: BlobPart[];
  readonly size: number;
  readonly type: string;

  constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
    this.parts = parts || [];
    this.type = options?.type || '';
    this.size = this.parts.reduce((acc, part) => {
      if (typeof part === 'string') return acc + part.length;
      if (part instanceof ArrayBuffer) return acc + part.byteLength;
      return acc;
    }, 0);
  }

  async text(): Promise<string> {
    return this.parts
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part instanceof ArrayBuffer) {
          return new TextDecoder().decode(part);
        }
        return '';
      })
      .join('');
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const text = await this.text();
    return new TextEncoder().encode(text).buffer;
  }

  slice(start?: number, end?: number, contentType?: string): Blob {
    return new MockBlob([], { type: contentType });
  }

  stream(): ReadableStream<Uint8Array> {
    throw new Error('stream() not implemented in mock');
  }

  bytes(): Promise<Uint8Array> {
    throw new Error('bytes() not implemented in mock');
  }
}

// Apply global mocks
(globalThis as unknown as Record<string, unknown>).Worker = MockWorker;
(globalThis as unknown as Record<string, unknown>).URL = MockURL;
(globalThis as unknown as Record<string, unknown>).Blob = MockBlob;

// Mock document for DOM operations
const mockDocument = {
  createElement: vi.fn((tag: string) => ({
    style: {},
    classList: { add: vi.fn(), remove: vi.fn() },
    setAttribute: vi.fn(),
    appendChild: vi.fn(),
    removeChild: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
  body: {
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  },
};

if (typeof document === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).document = mockDocument;
}

// Mock window
if (typeof window === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).window = globalThis;
}

export { MockWorker, MockBlob, MockURL };
