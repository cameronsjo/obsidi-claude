import type { App, TFile, CachedMetadata } from 'obsidian';
import type { EmbeddingSettings } from './types';
import { generateId } from './types';
import { EmbeddingService } from './EmbeddingService';
import { VectorStore, type VectorEntry, type SearchResult } from './VectorStore';
import { createLogger } from './Logger';

const log = createLogger('RAGService');

export interface IndexProgress {
  total: number;
  processed: number;
  currentFile?: string;
  status: 'idle' | 'indexing' | 'complete' | 'error';
  error?: string;
}

export interface RAGSearchOptions {
  limit?: number;
  minScore?: number;
  filterTags?: string[];
  filterFolders?: string[];
  excludeFolders?: string[];
}

/**
 * Splits text into chunks with overlap
 */
function chunkText(
  text: string,
  chunkSize: number,
  overlap: number
): string[] {
  const chunks: string[] = [];
  const separators = ['\n\n', '\n', '. ', ' ', ''];

  function splitRecursive(text: string, separatorIndex: number): string[] {
    if (text.length <= chunkSize) {
      return [text];
    }

    const separator = separators[separatorIndex];
    if (separatorIndex >= separators.length - 1) {
      // Fallback: hard split
      const result: string[] = [];
      for (let i = 0; i < text.length; i += chunkSize - overlap) {
        result.push(text.slice(i, i + chunkSize));
      }
      return result;
    }

    const parts = text.split(separator);
    const result: string[] = [];
    let current = '';

    for (const part of parts) {
      const addition = current ? separator + part : part;
      if ((current + addition).length <= chunkSize) {
        current += addition;
      } else {
        if (current) {
          result.push(current);
        }
        // If single part is too long, split it recursively
        if (part.length > chunkSize) {
          result.push(...splitRecursive(part, separatorIndex + 1));
          current = '';
        } else {
          current = part;
        }
      }
    }
    if (current) {
      result.push(current);
    }

    return result;
  }

  const rawChunks = splitRecursive(text, 0);

  // Add overlap between chunks
  for (let i = 0; i < rawChunks.length; i++) {
    let chunk = rawChunks[i];

    // Add text from previous chunk for context
    if (i > 0 && overlap > 0) {
      const prevChunk = rawChunks[i - 1];
      const overlapText = prevChunk.slice(-overlap);
      chunk = overlapText + chunk;
    }

    chunks.push(chunk.trim());
  }

  return chunks.filter((c) => c.length > 0);
}

/**
 * Extract metadata from Obsidian's cached metadata
 */
function extractMetadata(
  cache: CachedMetadata | null,
  filepath: string
): {
  title?: string;
  tags?: string[];
  headings?: string[];
  links?: string[];
  frontmatter?: Record<string, unknown>;
} {
  const result: {
    title?: string;
    tags?: string[];
    headings?: string[];
    links?: string[];
    frontmatter?: Record<string, unknown>;
  } = {};

  // Extract title from first heading or frontmatter
  if (cache?.frontmatter?.title) {
    result.title = String(cache.frontmatter.title);
  } else if (cache?.headings?.[0]) {
    result.title = cache.headings[0].heading;
  } else {
    // Use filename without extension
    result.title = filepath.split('/').pop()?.replace(/\.md$/, '');
  }

  // Extract tags
  const tags: string[] = [];
  if (cache?.tags) {
    tags.push(...cache.tags.map((t) => t.tag));
  }
  if (cache?.frontmatter?.tags) {
    const fmTags = cache.frontmatter.tags;
    if (Array.isArray(fmTags)) {
      tags.push(...fmTags.map((t) => (typeof t === 'string' ? `#${t}` : '')));
    }
  }
  if (tags.length > 0) {
    result.tags = [...new Set(tags)];
  }

  // Extract headings
  if (cache?.headings) {
    result.headings = cache.headings.map((h) => h.heading);
  }

  // Extract links
  if (cache?.links) {
    result.links = cache.links.map((l) => l.link);
  }

  // Include frontmatter
  if (cache?.frontmatter) {
    result.frontmatter = { ...cache.frontmatter };
  }

  return result;
}

export class RAGService {
  private app: App;
  private settings: EmbeddingSettings;
  private embeddingService: EmbeddingService;
  private vectorStore: VectorStore;
  private progress: IndexProgress = {
    total: 0,
    processed: 0,
    status: 'idle',
  };
  private progressCallbacks: Set<(progress: IndexProgress) => void> = new Set();

  constructor(app: App, settings: EmbeddingSettings, storagePath: string) {
    this.app = app;
    this.settings = settings;
    this.embeddingService = new EmbeddingService(settings);
    this.vectorStore = new VectorStore(storagePath);
  }

  async initialize(): Promise<void> {
    log.info('Initializing RAG service');
    await this.vectorStore.load();

    // Set provider info (will clear index if provider changed)
    if (this.embeddingService.isConfigured()) {
      const providerName = this.embeddingService.getProviderName();
      const dimensions = this.embeddingService.getDimensions();
      this.vectorStore.setProviderInfo(providerName, dimensions);
      log.info('RAG service initialized', {
        provider: providerName,
        dimensions,
        existingChunks: this.vectorStore.getEntryCount(),
      });
    } else {
      log.debug('RAG service initialized without embedding provider');
    }
  }

  updateSettings(settings: EmbeddingSettings): void {
    this.settings = settings;
    this.embeddingService.updateSettings(settings);
    log.debug('Settings updated', { provider: settings.provider, enabled: settings.enabled });

    // Check if provider changed
    if (this.embeddingService.isConfigured()) {
      this.vectorStore.setProviderInfo(
        this.embeddingService.getProviderName(),
        this.embeddingService.getDimensions()
      );
    }
  }

  onProgressChange(callback: (progress: IndexProgress) => void): () => void {
    this.progressCallbacks.add(callback);
    return () => this.progressCallbacks.delete(callback);
  }

  private notifyProgress(): void {
    for (const callback of this.progressCallbacks) {
      callback({ ...this.progress });
    }
  }

  getProgress(): IndexProgress {
    return { ...this.progress };
  }

  isConfigured(): boolean {
    return this.settings.enabled && this.embeddingService.isConfigured();
  }

  /**
   * Get all markdown files to index (respecting exclusions)
   */
  private getFilesToIndex(): TFile[] {
    const files = this.app.vault.getMarkdownFiles();
    const excludeFolders = this.settings.excludeFolders || [];

    return files.filter((file) => {
      for (const folder of excludeFolders) {
        if (file.path.startsWith(folder + '/') || file.path.startsWith(folder)) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Check if a file needs reindexing
   */
  private async needsReindex(file: TFile): Promise<boolean> {
    const content = await this.app.vault.cachedRead(file);
    const currentHash = VectorStore.computeContentHash(content);
    const storedHash = this.vectorStore.getFileHash(file.path);
    return currentHash !== storedHash;
  }

  /**
   * Index a single file
   */
  private async indexFile(file: TFile): Promise<void> {
    const content = await this.app.vault.cachedRead(file);
    const hash = VectorStore.computeContentHash(content);
    const cache = this.app.metadataCache.getFileCache(file);
    const metadata = extractMetadata(cache, file.path);

    // Chunk the content
    const chunks = chunkText(
      content,
      this.settings.chunkSize,
      this.settings.chunkOverlap
    );

    log.debug('Indexing file', { path: file.path, chunkCount: chunks.length, contentLength: content.length });

    // Generate embeddings for all chunks
    const embeddings = await this.embeddingService.embed(chunks);

    // Create vector entries
    const entries: VectorEntry[] = chunks.map((chunk, index) => ({
      id: generateId(),
      filepath: file.path,
      chunkIndex: index,
      content: chunk,
      metadata: {
        ...metadata,
        hash,
      },
      vector: embeddings[index],
    }));

    // Remove old entries and insert new ones
    await this.vectorStore.removeByFilepath(file.path);
    await this.vectorStore.insertBatch(entries);
    this.vectorStore.setFileHash(file.path, hash);
  }

  /**
   * Index all vault files (incremental by default)
   */
  async indexVault(force = false): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Embedding service not configured');
    }

    const files = this.getFilesToIndex();
    log.info('Starting vault indexing', { totalFiles: files.length, force });

    this.progress = {
      total: files.length,
      processed: 0,
      status: 'indexing',
    };
    this.notifyProgress();

    let indexed = 0;
    let skipped = 0;
    let failed = 0;

    try {
      for (const file of files) {
        this.progress.currentFile = file.path;
        this.notifyProgress();

        // Skip if not changed (unless force)
        if (!force && !(await this.needsReindex(file))) {
          this.progress.processed++;
          skipped++;
          continue;
        }

        try {
          await this.indexFile(file);
          indexed++;
        } catch (error) {
          log.error('Failed to index file', error, { path: file.path });
          failed++;
          // Continue with other files
        }

        this.progress.processed++;
        this.notifyProgress();
      }

      // Remove entries for deleted files
      const indexedFiles = new Set(this.vectorStore.getIndexedFiles());
      const currentFiles = new Set(files.map((f) => f.path));
      let removed = 0;
      for (const filepath of indexedFiles) {
        if (!currentFiles.has(filepath)) {
          await this.vectorStore.removeByFilepath(filepath);
          removed++;
        }
      }

      await this.vectorStore.save();
      this.progress.status = 'complete';
      this.progress.currentFile = undefined;

      log.info('Vault indexing completed', { indexed, skipped, failed, removed });
    } catch (error) {
      this.progress.status = 'error';
      this.progress.error = error instanceof Error ? error.message : String(error);
      log.error('Vault indexing failed', error);
    }

    this.notifyProgress();
  }

  /**
   * Index a single file (for file change events)
   */
  async indexSingleFile(file: TFile): Promise<void> {
    if (!this.isConfigured()) return;

    // Check exclusions
    for (const folder of this.settings.excludeFolders || []) {
      if (file.path.startsWith(folder + '/') || file.path.startsWith(folder)) {
        log.debug('Skipping excluded file', { path: file.path, excludedBy: folder });
        return;
      }
    }

    try {
      log.debug('Indexing single file', { path: file.path });
      await this.indexFile(file);
      await this.vectorStore.save();
    } catch (error) {
      log.error('Failed to index single file', error, { path: file.path });
    }
  }

  /**
   * Remove a file from the index
   */
  async removeFile(filepath: string): Promise<void> {
    log.debug('Removing file from index', { path: filepath });
    await this.vectorStore.removeByFilepath(filepath);
    await this.vectorStore.save();
  }

  /**
   * Semantic search across the vault
   */
  async search(query: string, options: RAGSearchOptions = {}): Promise<SearchResult[]> {
    if (!this.isConfigured()) {
      throw new Error('Embedding service not configured');
    }

    log.debug('Performing semantic search', {
      queryLength: query.length,
      limit: options.limit,
      minScore: options.minScore,
      hasFilters: !!(options.filterTags || options.filterFolders || options.excludeFolders),
    });

    const queryVector = await this.embeddingService.embedSingle(query);
    const limit = options.limit || 10;
    const minScore = options.minScore || 0.3;

    let results: SearchResult[];

    if (options.filterTags || options.filterFolders || options.excludeFolders) {
      results = await this.vectorStore.searchWithFilter(
        queryVector,
        (doc) => {
          // Filter by tags
          if (options.filterTags && options.filterTags.length > 0) {
            const docTags = doc.metadata.tags || [];
            const hasTag = options.filterTags.some(
              (tag) =>
                docTags.includes(tag) ||
                docTags.includes('#' + tag.replace(/^#/, ''))
            );
            if (!hasTag) return false;
          }

          // Filter by folders
          if (options.filterFolders && options.filterFolders.length > 0) {
            const inFolder = options.filterFolders.some((folder) =>
              doc.filepath.startsWith(folder + '/')
            );
            if (!inFolder) return false;
          }

          // Exclude folders
          if (options.excludeFolders && options.excludeFolders.length > 0) {
            const excluded = options.excludeFolders.some((folder) =>
              doc.filepath.startsWith(folder + '/')
            );
            if (excluded) return false;
          }

          return true;
        },
        limit
      );
    } else {
      results = await this.vectorStore.search(queryVector, limit);
    }

    // Filter by minimum score
    const filtered = results.filter((r) => r.score >= minScore);
    log.info('Search completed', {
      resultCount: filtered.length,
      totalCandidates: results.length,
      topScore: filtered[0]?.score ?? 0,
    });
    return filtered;
  }

  /**
   * Get statistics about the index
   */
  getStats(): {
    totalChunks: number;
    totalFiles: number;
    isConfigured: boolean;
    providerName: string | null;
  } {
    return {
      totalChunks: this.vectorStore.getEntryCount(),
      totalFiles: this.vectorStore.getIndexedFiles().length,
      isConfigured: this.isConfigured(),
      providerName: this.isConfigured()
        ? this.embeddingService.getProviderName()
        : null,
    };
  }

  /**
   * Clear the entire index
   */
  async clearIndex(): Promise<void> {
    log.info('Clearing entire index');
    this.vectorStore.clear();
    await this.vectorStore.save();
  }
}
