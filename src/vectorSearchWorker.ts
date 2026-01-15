/**
 * Web Worker for vector similarity search
 *
 * Offloads cosine similarity calculations to a worker thread
 * to keep the UI responsive during semantic search.
 */

import { createLogger } from './logger';
import type { VectorDocument, VectorEntry, SearchResult } from './vectorStore';

const log = createLogger('VectorSearchWorker');

// Re-export types for consumers
export type { VectorDocument, VectorEntry, SearchResult };

// Worker response types
interface WorkerResponse {
  id: number;
  type: 'success' | 'error';
  payload?: {
    results?: SearchResult[];
    count?: number;
    status?: string;
  };
  error?: string;
}

// Inline worker code for vector search
const WORKER_CODE = `
// Vector entries stored in worker memory
let entries = [];

/**
 * Cosine similarity between two vectors
 * Optimized with loop unrolling for common dimensions
 */
function cosineSimilarity(a, b) {
  const len = a.length;
  if (len !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  // Process 4 elements at a time for better performance
  const unrolledLen = len - (len % 4);
  let i = 0;

  for (; i < unrolledLen; i += 4) {
    dotProduct += a[i] * b[i] + a[i+1] * b[i+1] + a[i+2] * b[i+2] + a[i+3] * b[i+3];
    normA += a[i] * a[i] + a[i+1] * a[i+1] + a[i+2] * a[i+2] + a[i+3] * a[i+3];
    normB += b[i] * b[i] + b[i+1] * b[i+1] + b[i+2] * b[i+2] + b[i+3] * b[i+3];
  }

  // Handle remaining elements
  for (; i < len; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Search for similar vectors
 */
function search(queryVector, limit, minScore = 0) {
  const results = [];

  for (const entry of entries) {
    const score = cosineSimilarity(queryVector, entry.vector);
    if (score >= minScore) {
      results.push({
        document: {
          id: entry.id,
          filepath: entry.filepath,
          chunkIndex: entry.chunkIndex,
          content: entry.content,
          metadata: entry.metadata,
        },
        score,
      });
    }
  }

  // Sort by score descending and limit
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Search with filepath filter
 */
function searchWithFilter(queryVector, filterFn, limit, minScore = 0) {
  const results = [];

  for (const entry of entries) {
    // Apply filter (passed as serializable criteria)
    if (filterFn && !matchesFilter(entry, filterFn)) continue;

    const score = cosineSimilarity(queryVector, entry.vector);
    if (score >= minScore) {
      results.push({
        document: {
          id: entry.id,
          filepath: entry.filepath,
          chunkIndex: entry.chunkIndex,
          content: entry.content,
          metadata: entry.metadata,
        },
        score,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Match entry against filter criteria
 */
function matchesFilter(entry, filter) {
  if (filter.includeFolders?.length) {
    const inFolder = filter.includeFolders.some(f => entry.filepath.startsWith(f));
    if (!inFolder) return false;
  }

  if (filter.excludeFolders?.length) {
    const excluded = filter.excludeFolders.some(f => entry.filepath.startsWith(f));
    if (excluded) return false;
  }

  if (filter.includeTags?.length && entry.metadata?.tags) {
    const hasTag = filter.includeTags.some(t => entry.metadata.tags.includes(t));
    if (!hasTag) return false;
  }

  return true;
}

// Message handler
self.onmessage = (event) => {
  const { id, type, payload } = event.data;

  try {
    switch (type) {
      case 'setEntries': {
        entries = payload.entries || [];
        self.postMessage({
          id,
          type: 'success',
          payload: { count: entries.length, status: 'entries_loaded' }
        });
        break;
      }

      case 'addEntries': {
        const newEntries = payload.entries || [];
        // Remove duplicates by filepath+chunkIndex
        for (const entry of newEntries) {
          const idx = entries.findIndex(
            e => e.filepath === entry.filepath && e.chunkIndex === entry.chunkIndex
          );
          if (idx >= 0) {
            entries[idx] = entry;
          } else {
            entries.push(entry);
          }
        }
        self.postMessage({
          id,
          type: 'success',
          payload: { count: entries.length, status: 'entries_added' }
        });
        break;
      }

      case 'removeByFilepath': {
        const filepath = payload.filepath;
        entries = entries.filter(e => e.filepath !== filepath);
        self.postMessage({
          id,
          type: 'success',
          payload: { count: entries.length, status: 'entries_removed' }
        });
        break;
      }

      case 'clear': {
        entries = [];
        self.postMessage({
          id,
          type: 'success',
          payload: { count: 0, status: 'cleared' }
        });
        break;
      }

      case 'search': {
        const { queryVector, limit = 10, minScore = 0 } = payload;
        const results = search(queryVector, limit, minScore);
        self.postMessage({
          id,
          type: 'success',
          payload: { results }
        });
        break;
      }

      case 'searchWithFilter': {
        const { queryVector, filter, limit = 10, minScore = 0 } = payload;
        const results = searchWithFilter(queryVector, filter, limit, minScore);
        self.postMessage({
          id,
          type: 'success',
          payload: { results }
        });
        break;
      }

      case 'getCount': {
        self.postMessage({
          id,
          type: 'success',
          payload: { count: entries.length }
        });
        break;
      }

      default:
        throw new Error('Unknown message type: ' + type);
    }
  } catch (error) {
    self.postMessage({
      id,
      type: 'error',
      error: error.message || String(error)
    });
  }
};

self.postMessage({ id: -1, type: 'success', payload: { status: 'worker_ready' } });
`;

export interface SearchFilter {
  includeFolders?: string[];
  excludeFolders?: string[];
  includeTags?: string[];
}

export class VectorSearchWorkerManager {
  private worker: Worker | null = null;
  private requestId = 0;
  private pendingRequests: Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  > = new Map();
  private initialized = false;
  private entryCount = 0;

  /**
   * Initialize the worker
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    log.info('Initializing vector search worker');

    // Create worker from inline code
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
    this.initialized = true;

    log.info('Vector search worker initialized');

    // Clean up blob URL
    URL.revokeObjectURL(workerUrl);
  }

  /**
   * Load entries into the worker
   */
  async setEntries(entries: VectorEntry[]): Promise<void> {
    if (!this.initialized) await this.initialize();

    const result = (await this.sendRequest('setEntries', { entries })) as { count: number };
    this.entryCount = result.count;
    log.debug('Entries loaded into worker', { count: this.entryCount });
  }

  /**
   * Add or update entries in the worker
   */
  async addEntries(entries: VectorEntry[]): Promise<void> {
    if (!this.initialized) await this.initialize();

    const result = (await this.sendRequest('addEntries', { entries })) as { count: number };
    this.entryCount = result.count;
  }

  /**
   * Remove entries by filepath
   */
  async removeByFilepath(filepath: string): Promise<void> {
    if (!this.initialized) await this.initialize();

    const result = (await this.sendRequest('removeByFilepath', { filepath })) as { count: number };
    this.entryCount = result.count;
  }

  /**
   * Clear all entries
   */
  async clear(): Promise<void> {
    if (!this.initialized) await this.initialize();

    await this.sendRequest('clear', {});
    this.entryCount = 0;
  }

  /**
   * Search for similar vectors
   */
  async search(queryVector: number[], limit = 10, minScore = 0): Promise<SearchResult[]> {
    if (!this.initialized) await this.initialize();

    const result = (await this.sendRequest('search', {
      queryVector,
      limit,
      minScore,
    })) as { results: SearchResult[] };

    return result.results;
  }

  /**
   * Search with filter criteria
   */
  async searchWithFilter(
    queryVector: number[],
    filter: SearchFilter,
    limit = 10,
    minScore = 0
  ): Promise<SearchResult[]> {
    if (!this.initialized) await this.initialize();

    const result = (await this.sendRequest('searchWithFilter', {
      queryVector,
      filter,
      limit,
      minScore,
    })) as { results: SearchResult[] };

    return result.results;
  }

  /**
   * Get entry count
   */
  async getCount(): Promise<number> {
    if (!this.initialized) return 0;

    const result = (await this.sendRequest('getCount', {})) as { count: number };
    return result.count;
  }

  /**
   * Get cached entry count (no worker call)
   */
  getEntryCount(): number {
    return this.entryCount;
  }

  /**
   * Terminate the worker
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.initialized = false;
      this.entryCount = 0;
    }
  }

  private handleMessage(response: WorkerResponse): void {
    const { id, type, payload, error } = response;

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

  private sendRequest(type: string, payload: Record<string, unknown>): Promise<unknown> {
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
      setTimeout(resolve, 50);
    });
  }
}
