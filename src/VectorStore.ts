import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

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
 * Simple local vector store using JSON storage
 * Implements cosine similarity search
 */
export class VectorStore {
  private indexPath: string;
  private data: IndexData;
  private dirty = false;

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

  async load(): Promise<void> {
    try {
      if (fs.existsSync(this.indexPath)) {
        const content = fs.readFileSync(this.indexPath, 'utf-8');
        this.data = JSON.parse(content) as IndexData;
      }
    } catch (error) {
      console.error('Failed to load vector index:', error);
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
  }

  async insertBatch(entries: VectorEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.insert(entry);
    }
  }

  async removeByFilepath(filepath: string): Promise<void> {
    const initialCount = this.data.entries.length;
    this.data.entries = this.data.entries.filter((e) => e.filepath !== filepath);
    delete this.data.fileHashes[filepath];
    if (this.data.entries.length !== initialCount) {
      this.dirty = true;
    }
  }

  async search(queryVector: number[], limit = 10): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (const entry of this.data.entries) {
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

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async searchWithFilter(
    queryVector: number[],
    filter: (doc: VectorDocument) => boolean,
    limit = 10
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (const entry of this.data.entries) {
      if (!filter(entry)) continue;
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

  clear(): void {
    this.data.entries = [];
    this.data.fileHashes = {};
    this.dirty = true;
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
}
