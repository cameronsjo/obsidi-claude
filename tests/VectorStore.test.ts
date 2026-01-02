import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorStore, type VectorEntry } from '../src/VectorStore';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('VectorStore', () => {
  let tempDir: string;
  let store: VectorStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vectorstore-test-'));
    store = new VectorStore(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('computeContentHash', () => {
    it('should generate consistent hashes', () => {
      const content = 'Hello, world!';
      const hash1 = VectorStore.computeContentHash(content);
      const hash2 = VectorStore.computeContentHash(content);
      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different content', () => {
      const hash1 = VectorStore.computeContentHash('content1');
      const hash2 = VectorStore.computeContentHash('content2');
      expect(hash1).not.toBe(hash2);
    });

    it('should return a hex string', () => {
      const hash = VectorStore.computeContentHash('test');
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe('insert and search', () => {
    const createEntry = (
      id: string,
      vector: number[],
      content: string = 'test content'
    ): VectorEntry => ({
      id,
      filepath: `/test/${id}.md`,
      chunkIndex: 0,
      content,
      vector,
      metadata: {
        hash: VectorStore.computeContentHash(content),
      },
    });

    it('should insert and retrieve entries', async () => {
      store.setProviderInfo('test', 3);
      const entry = createEntry('doc1', [1, 0, 0]);
      await store.insert(entry);
      expect(store.getEntryCount()).toBe(1);
    });

    it('should find exact matches with score 1.0', async () => {
      store.setProviderInfo('test', 3);
      await store.insert(createEntry('doc1', [1, 0, 0]));

      const results = await store.search([1, 0, 0], 10);
      expect(results).toHaveLength(1);
      expect(results[0].score).toBeCloseTo(1.0, 5);
    });

    it('should find similar vectors', async () => {
      store.setProviderInfo('test', 3);
      await store.insert(createEntry('doc1', [1, 0, 0]));
      await store.insert(createEntry('doc2', [0.9, 0.1, 0]));
      await store.insert(createEntry('doc3', [0, 1, 0]));

      const results = await store.search([1, 0, 0], 10);
      expect(results).toHaveLength(3);
      // doc1 should be first (exact match)
      expect(results[0].document.id).toBe('doc1');
      // doc2 should be second (similar)
      expect(results[1].document.id).toBe('doc2');
      // doc3 should be last (orthogonal)
      expect(results[2].document.id).toBe('doc3');
    });

    it('should respect limit parameter', async () => {
      store.setProviderInfo('test', 3);
      await store.insert(createEntry('doc1', [1, 0, 0]));
      await store.insert(createEntry('doc2', [0, 1, 0]));
      await store.insert(createEntry('doc3', [0, 0, 1]));

      const results = await store.search([1, 1, 1], 2);
      expect(results).toHaveLength(2);
    });

    it('should handle orthogonal vectors', async () => {
      store.setProviderInfo('test', 3);
      await store.insert(createEntry('doc1', [1, 0, 0]));

      const results = await store.search([0, 1, 0], 10);
      expect(results[0].score).toBeCloseTo(0, 5);
    });

    it('should handle opposite vectors', async () => {
      store.setProviderInfo('test', 3);
      await store.insert(createEntry('doc1', [1, 0, 0]));

      // Need to pass minScore=-1 to get negative scores (default minScore=0 filters them)
      const results = await store.search([-1, 0, 0], 10, -1);
      expect(results[0].score).toBeCloseTo(-1.0, 5);
    });
  });

  describe('searchWithFilter', () => {
    const createEntry = (
      id: string,
      vector: number[],
      tags: string[] = []
    ): VectorEntry => ({
      id,
      filepath: `/test/${id}.md`,
      chunkIndex: 0,
      content: 'test',
      vector,
      metadata: {
        hash: 'test',
        tags,
      },
    });

    it('should filter results', async () => {
      store.setProviderInfo('test', 3);
      await store.insert(createEntry('doc1', [1, 0, 0], ['important']));
      await store.insert(createEntry('doc2', [0.9, 0.1, 0], []));

      // Use SearchFilter object instead of function
      const results = await store.searchWithFilter(
        [1, 0, 0],
        { includeTags: ['important'] },
        10
      );

      expect(results).toHaveLength(1);
      expect(results[0].document.id).toBe('doc1');
    });

    it('should filter with function (legacy)', async () => {
      store.setProviderInfo('test', 3);
      await store.insert(createEntry('doc1', [1, 0, 0], ['important']));
      await store.insert(createEntry('doc2', [0.9, 0.1, 0], []));

      // Use legacy function filter (runs on main thread)
      const results = await store.searchWithFunctionFilter(
        [1, 0, 0],
        (doc) => doc.metadata.tags?.includes('important') ?? false,
        10
      );

      expect(results).toHaveLength(1);
      expect(results[0].document.id).toBe('doc1');
    });
  });

  describe('file operations', () => {
    it('should remove entries by filepath', async () => {
      store.setProviderInfo('test', 3);
      await store.insert({
        id: 'doc1',
        filepath: '/test/file1.md',
        chunkIndex: 0,
        content: 'test',
        vector: [1, 0, 0],
        metadata: { hash: 'test' },
      });
      await store.insert({
        id: 'doc2',
        filepath: '/test/file2.md',
        chunkIndex: 0,
        content: 'test',
        vector: [0, 1, 0],
        metadata: { hash: 'test' },
      });

      expect(store.getEntryCount()).toBe(2);
      await store.removeByFilepath('/test/file1.md');
      expect(store.getEntryCount()).toBe(1);
    });

    it('should track file hashes', () => {
      store.setFileHash('/test.md', 'abc123');
      expect(store.getFileHash('/test.md')).toBe('abc123');
      expect(store.getFileHash('/nonexistent.md')).toBeUndefined();
    });

    it('should list indexed files', () => {
      store.setFileHash('/file1.md', 'hash1');
      store.setFileHash('/file2.md', 'hash2');
      const files = store.getIndexedFiles();
      expect(files).toContain('/file1.md');
      expect(files).toContain('/file2.md');
    });
  });

  describe('persistence', () => {
    it('should save and load index', async () => {
      store.setProviderInfo('test-provider', 3);
      await store.insert({
        id: 'doc1',
        filepath: '/test.md',
        chunkIndex: 0,
        content: 'Hello world',
        vector: [1, 2, 3],
        metadata: { hash: 'abc' },
      });
      store.setFileHash('/test.md', 'filehash');
      await store.save();

      // Create new store and load
      const store2 = new VectorStore(tempDir);
      await store2.load();

      expect(store2.getEntryCount()).toBe(1);
      expect(store2.getFileHash('/test.md')).toBe('filehash');
    });
  });

  describe('provider changes', () => {
    it('should clear index when provider changes', async () => {
      store.setProviderInfo('provider1', 3);
      await store.insert({
        id: 'doc1',
        filepath: '/test.md',
        chunkIndex: 0,
        content: 'test',
        vector: [1, 0, 0],
        metadata: { hash: 'test' },
      });
      expect(store.getEntryCount()).toBe(1);

      // Change provider
      store.setProviderInfo('provider2', 3);
      expect(store.getEntryCount()).toBe(0);
    });

    it('should clear index when dimensions change', async () => {
      store.setProviderInfo('provider1', 3);
      await store.insert({
        id: 'doc1',
        filepath: '/test.md',
        chunkIndex: 0,
        content: 'test',
        vector: [1, 0, 0],
        metadata: { hash: 'test' },
      });

      store.setProviderInfo('provider1', 4);
      expect(store.getEntryCount()).toBe(0);
    });
  });

  describe('chunk handling', () => {
    it('should replace existing chunk on re-insert', async () => {
      store.setProviderInfo('test', 3);

      await store.insert({
        id: 'doc1-v1',
        filepath: '/test.md',
        chunkIndex: 0,
        content: 'version 1',
        vector: [1, 0, 0],
        metadata: { hash: 'v1' },
      });

      await store.insert({
        id: 'doc1-v2',
        filepath: '/test.md',
        chunkIndex: 0,
        content: 'version 2',
        vector: [0, 1, 0],
        metadata: { hash: 'v2' },
      });

      expect(store.getEntryCount()).toBe(1);
      const entries = await store.getEntriesForFile('/test.md');
      expect(entries[0].content).toBe('version 2');
    });
  });
});

describe('Cosine similarity edge cases', () => {
  let store: VectorStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cosine-test-'));
    store = new VectorStore(tempDir);
    store.setProviderInfo('test', 3);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should handle zero vectors gracefully', async () => {
    await store.insert({
      id: 'doc1',
      filepath: '/test.md',
      chunkIndex: 0,
      content: 'test',
      vector: [0, 0, 0],
      metadata: { hash: 'test' },
    });

    const results = await store.search([1, 0, 0], 10);
    expect(results[0].score).toBe(0);
  });

  it('should handle normalized vectors', async () => {
    // Normalized vector (length = 1)
    const norm = Math.sqrt(3);
    await store.insert({
      id: 'doc1',
      filepath: '/test.md',
      chunkIndex: 0,
      content: 'test',
      vector: [1 / norm, 1 / norm, 1 / norm],
      metadata: { hash: 'test' },
    });

    const results = await store.search([1 / norm, 1 / norm, 1 / norm], 10);
    expect(results[0].score).toBeCloseTo(1.0, 5);
  });
});
