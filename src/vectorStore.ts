import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { VectorSearchWorkerManager, type SearchFilter } from './vectorSearchWorker';
import { createLogger } from './logger';

const log = createLogger('VectorStore');

export interface VectorDocument {
  id: string;
  filepath: string;
  chunkIndex: number;
  content: string;
  metadata: {
    title?: string;
    tags?: string[];
    headings?: string[];
    links?: string[];
    frontmatter?: Record<string, unknown>;
    hash: string;
  };
}

export interface VectorEntry extends VectorDocument {
  vector: number[];
}

export interface SearchResult {
  document: VectorDocument;
  score: number;
}

interface IndexData {
  version: number;
  dimensions: number;
  providerName: string;
  entries: VectorEntry[];
  fileHashes: Record<string, string>;
}

/**
 * Local vector store using JSON storage with Web Worker search
 *
 * Search operations are offloaded to a worker thread to keep the UI responsive.
 * The worker maintains its own copy of the vector data for fast similarity search.
 */
export class VectorStore {
  private indexPath: string;
  private data: IndexData;
  private dirty = false;
  private searchWorker: VectorSearchWorkerManager | null = null;
  private workerSynced = false;

  constructor(storagePath: string) {
    this.indexPath = path.join(storagePath, 'vector-index.json');
    this.data = {
      version: 1,
      dimensions: 0,
      providerName: '',
      entries: [],
      fileHashes: {},
    };
  }

  /**
   * Initialize the search worker
   */
  private async ensureWorker(): Promise<VectorSearchWorkerManager> {
    if (!this.searchWorker) {
      this.searchWorker = new VectorSearchWorkerManager();
      await this.searchWorker.initialize();
    }

    // Sync entries to worker if not done yet
    if (!this.workerSynced && this.data.entries.length > 0) {
      await this.searchWorker.setEntries(this.data.entries);
      this.workerSynced = true;
      log.debug('Synced entries to search worker', { count: this.data.entries.length });
    }

    return this.searchWorker;
  }

  async load(): Promise<void> {
    try {
      if (fs.existsSync(this.indexPath)) {
        const content = fs.readFileSync(this.indexPath, 'utf-8');
        this.data = JSON.parse(content) as IndexData;
        this.workerSynced = false; // Need to sync to worker
        log.info('Loaded vector index', { entries: this.data.entries.length });
      }
    } catch (error) {
      log.error('Failed to load vector index', error);
      // Start fresh on error
      this.data = {
        version: 1,
        dimensions: 0,
        providerName: '',
        entries: [],
        fileHashes: {},
      };
    }
  }

  async save(): Promise<void> {
    if (!this.dirty) return;

    try {
      const dir = path.dirname(this.indexPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.indexPath, JSON.stringify(this.data, null, 2));
      this.dirty = false;
    } catch (error) {
      console.error('Failed to save vector index:', error);
      throw error;
    }
  }

  setProviderInfo(providerName: string, dimensions: number): void {
    // If provider changed, clear the index
    if (
      this.data.providerName !== providerName ||
      this.data.dimensions !== dimensions
    ) {
      this.clear();
      this.data.providerName = providerName;
      this.data.dimensions = dimensions;
      this.dirty = true;
    }
  }

  getFileHash(filepath: string): string | undefined {
    return this.data.fileHashes[filepath];
  }

  setFileHash(filepath: string, hash: string): void {
    this.data.fileHashes[filepath] = hash;
    this.dirty = true;
  }

  static computeContentHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  async insert(entry: VectorEntry): Promise<void> {
    // Remove existing entries for this chunk
    this.data.entries = this.data.entries.filter(
      (e) => !(e.filepath === entry.filepath && e.chunkIndex === entry.chunkIndex)
    );
    this.data.entries.push(entry);
    this.dirty = true;

    // Update worker
    if (this.searchWorker && this.workerSynced) {
      await this.searchWorker.addEntries([entry]);
    }
  }

  async insertBatch(entries: VectorEntry[]): Promise<void> {
    for (const entry of entries) {
      // Remove existing entries for this chunk
      this.data.entries = this.data.entries.filter(
        (e) => !(e.filepath === entry.filepath && e.chunkIndex === entry.chunkIndex)
      );
      this.data.entries.push(entry);
    }
    this.dirty = true;

    // Update worker
    if (this.searchWorker && this.workerSynced) {
      await this.searchWorker.addEntries(entries);
    }
  }

  async removeByFilepath(filepath: string): Promise<void> {
    const initialCount = this.data.entries.length;
    this.data.entries = this.data.entries.filter((e) => e.filepath !== filepath);
    delete this.data.fileHashes[filepath];
    if (this.data.entries.length !== initialCount) {
      this.dirty = true;

      // Update worker
      if (this.searchWorker && this.workerSynced) {
        await this.searchWorker.removeByFilepath(filepath);
      }
    }
  }

  /**
   * Search for similar vectors using the worker thread
   */
  async search(queryVector: number[], limit = 10, minScore = 0): Promise<SearchResult[]> {
    const worker = await this.ensureWorker();
    return worker.search(queryVector, limit, minScore);
  }

  /**
   * Search with filter criteria using the worker thread
   */
  async searchWithFilter(
    queryVector: number[],
    filter: SearchFilter,
    limit = 10,
    minScore = 0
  ): Promise<SearchResult[]> {
    const worker = await this.ensureWorker();
    return worker.searchWithFilter(queryVector, filter, limit, minScore);
  }

  /**
   * Legacy search with function filter (falls back to main thread)
   * @deprecated Use searchWithFilter with SearchFilter object instead
   */
  async searchWithFunctionFilter(
    queryVector: number[],
    filterFn: (doc: VectorDocument) => boolean,
    limit = 10
  ): Promise<SearchResult[]> {
    // Function filters can't be serialized to worker, run on main thread
    const results: SearchResult[] = [];

    for (const entry of this.data.entries) {
      if (!filterFn(entry)) continue;
      const score = this.cosineSimilarity(queryVector, entry.vector);
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

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vector dimensions must match');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  getEntryCount(): number {
    return this.data.entries.length;
  }

  getIndexedFiles(): string[] {
    return Object.keys(this.data.fileHashes);
  }

  async clear(): Promise<void> {
    this.data.entries = [];
    this.data.fileHashes = {};
    this.dirty = true;
    this.workerSynced = false;

    // Clear worker
    if (this.searchWorker) {
      await this.searchWorker.clear();
    }
  }

  async getEntriesForFile(filepath: string): Promise<VectorDocument[]> {
    return this.data.entries
      .filter((e) => e.filepath === filepath)
      .map((e) => ({
        id: e.id,
        filepath: e.filepath,
        chunkIndex: e.chunkIndex,
        content: e.content,
        metadata: e.metadata,
      }));
  }

  /**
   * Terminate the search worker
   */
  terminate(): void {
    if (this.searchWorker) {
      this.searchWorker.terminate();
      this.searchWorker = null;
      this.workerSynced = false;
    }
  }
}
