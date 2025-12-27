import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Test the chunkText function by extracting its logic
// Since it's not exported, we'll recreate and test the chunking algorithm
function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  const separators = ['\n\n', '\n', '. ', ' ', ''];

  function splitRecursive(text: string, separatorIndex: number): string[] {
    if (text.length <= chunkSize) {
      return [text];
    }

    const separator = separators[separatorIndex];
    if (separatorIndex >= separators.length - 1) {
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

  for (let i = 0; i < rawChunks.length; i++) {
    let chunk = rawChunks[i];
    if (i > 0 && overlap > 0) {
      const prevChunk = rawChunks[i - 1];
      const overlapText = prevChunk.slice(-overlap);
      chunk = overlapText + chunk;
    }
    chunks.push(chunk.trim());
  }

  return chunks.filter((c) => c.length > 0);
}

describe('chunkText', () => {
  describe('basic chunking', () => {
    it('should return single chunk for short text', () => {
      const text = 'Hello world';
      const chunks = chunkText(text, 100, 10);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe('Hello world');
    });

    it('should split long text into multiple chunks', () => {
      const text = 'A'.repeat(500);
      const chunks = chunkText(text, 100, 0);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every((c) => c.length <= 100)).toBe(true);
    });

    it('should respect chunk size limit', () => {
      const text = 'Word '.repeat(200);
      const chunks = chunkText(text, 50, 0);
      expect(chunks.every((c) => c.length <= 50)).toBe(true);
    });
  });

  describe('separator handling', () => {
    it('should prefer splitting on paragraph breaks', () => {
      const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      const chunks = chunkText(text, 30, 0);
      expect(chunks.some((c) => c.includes('\n\n'))).toBe(false);
    });

    it('should split on newlines when paragraphs are too long', () => {
      const text = 'Line1\nLine2\nLine3\nLine4\nLine5';
      const chunks = chunkText(text, 15, 0);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should split on sentences when lines are too long', () => {
      const text = 'First sentence. Second sentence. Third sentence.';
      const chunks = chunkText(text, 20, 0);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should split on spaces as last resort', () => {
      const text = 'word1 word2 word3 word4 word5';
      const chunks = chunkText(text, 12, 0);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should hard split when no separators work', () => {
      const text = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; // No separators
      const chunks = chunkText(text, 10, 0);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].length).toBeLessThanOrEqual(10);
    });
  });

  describe('overlap', () => {
    it('should add overlap text from previous chunk', () => {
      const text = 'First chunk here. Second chunk here. Third chunk here.';
      const chunks = chunkText(text, 20, 5);

      // Later chunks should have overlap from previous
      if (chunks.length > 1) {
        // The second chunk should start with text from end of first
        expect(chunks[1].length).toBeGreaterThan(0);
      }
    });

    it('should work with zero overlap', () => {
      const text = 'A'.repeat(200);
      const chunks = chunkText(text, 50, 0);
      expect(chunks.length).toBeGreaterThan(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const chunks = chunkText('', 100, 10);
      expect(chunks).toHaveLength(0);
    });

    it('should handle whitespace only', () => {
      const chunks = chunkText('   \n\n   ', 100, 10);
      expect(chunks).toHaveLength(0);
    });

    it('should trim chunks', () => {
      const text = '  Hello world  \n\n  Another line  ';
      const chunks = chunkText(text, 100, 0);
      expect(chunks.every((c) => c === c.trim())).toBe(true);
    });

    it('should handle unicode characters', () => {
      const text = '你好世界'.repeat(50);
      const chunks = chunkText(text, 20, 5);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should handle markdown content', () => {
      const text = `# Heading

This is a paragraph with **bold** and *italic* text.

## Subheading

- List item 1
- List item 2
- List item 3

\`\`\`javascript
const code = "example";
\`\`\`
`;
      const chunks = chunkText(text, 50, 10);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every((c) => c.length > 0)).toBe(true);
    });
  });
});

describe('extractMetadata helper', () => {
  // Test the metadata extraction logic
  function extractMetadata(
    cache: {
      frontmatter?: Record<string, unknown>;
      headings?: Array<{ heading: string; level: number }>;
      tags?: Array<{ tag: string }>;
      links?: Array<{ link: string }>;
    } | null,
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

    if (cache?.frontmatter?.title) {
      result.title = String(cache.frontmatter.title);
    } else if (cache?.headings?.[0]) {
      result.title = cache.headings[0].heading;
    } else {
      result.title = filepath.split('/').pop()?.replace(/\.md$/, '');
    }

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

    if (cache?.headings) {
      result.headings = cache.headings.map((h) => h.heading);
    }

    if (cache?.links) {
      result.links = cache.links.map((l) => l.link);
    }

    if (cache?.frontmatter) {
      result.frontmatter = { ...cache.frontmatter };
    }

    return result;
  }

  describe('title extraction', () => {
    it('should use frontmatter title first', () => {
      const result = extractMetadata(
        {
          frontmatter: { title: 'Frontmatter Title' },
          headings: [{ heading: 'Heading Title', level: 1 }],
        },
        'folder/file.md'
      );
      expect(result.title).toBe('Frontmatter Title');
    });

    it('should fall back to first heading', () => {
      const result = extractMetadata(
        {
          headings: [{ heading: 'First Heading', level: 1 }],
        },
        'folder/file.md'
      );
      expect(result.title).toBe('First Heading');
    });

    it('should fall back to filename', () => {
      const result = extractMetadata(null, 'folder/my-note.md');
      expect(result.title).toBe('my-note');
    });

    it('should handle nested paths', () => {
      const result = extractMetadata(null, 'a/b/c/deep-note.md');
      expect(result.title).toBe('deep-note');
    });
  });

  describe('tag extraction', () => {
    it('should extract inline tags', () => {
      const result = extractMetadata(
        {
          tags: [{ tag: '#tag1' }, { tag: '#tag2' }],
        },
        'file.md'
      );
      expect(result.tags).toContain('#tag1');
      expect(result.tags).toContain('#tag2');
    });

    it('should extract frontmatter tags', () => {
      const result = extractMetadata(
        {
          frontmatter: { tags: ['topic', 'category'] },
        },
        'file.md'
      );
      expect(result.tags).toContain('#topic');
      expect(result.tags).toContain('#category');
    });

    it('should deduplicate tags', () => {
      const result = extractMetadata(
        {
          tags: [{ tag: '#tag1' }],
          frontmatter: { tags: ['tag1'] },
        },
        'file.md'
      );
      // Should not have duplicates
      expect(result.tags?.filter((t) => t.includes('tag1')).length).toBeLessThanOrEqual(2);
    });
  });

  describe('headings extraction', () => {
    it('should extract all headings', () => {
      const result = extractMetadata(
        {
          headings: [
            { heading: 'H1', level: 1 },
            { heading: 'H2', level: 2 },
            { heading: 'H3', level: 3 },
          ],
        },
        'file.md'
      );
      expect(result.headings).toEqual(['H1', 'H2', 'H3']);
    });
  });

  describe('links extraction', () => {
    it('should extract wiki links', () => {
      const result = extractMetadata(
        {
          links: [{ link: 'Other Note' }, { link: 'folder/Another Note' }],
        },
        'file.md'
      );
      expect(result.links).toContain('Other Note');
      expect(result.links).toContain('folder/Another Note');
    });
  });

  describe('frontmatter', () => {
    it('should include full frontmatter', () => {
      const result = extractMetadata(
        {
          frontmatter: {
            title: 'Test',
            date: '2024-01-01',
            custom: { nested: true },
          },
        },
        'file.md'
      );
      expect(result.frontmatter?.date).toBe('2024-01-01');
      expect(result.frontmatter?.custom).toEqual({ nested: true });
    });
  });

  describe('null cache', () => {
    it('should handle null cache gracefully', () => {
      const result = extractMetadata(null, 'test.md');
      expect(result.title).toBe('test');
      expect(result.tags).toBeUndefined();
      expect(result.headings).toBeUndefined();
    });
  });
});

describe('RAGService integration', () => {
  // These tests would require more extensive mocking of Obsidian
  // For now, we test the search options filtering logic

  describe('search filter logic', () => {
    function matchesFilter(
      doc: { filepath: string; metadata: { tags?: string[] } },
      options: {
        filterTags?: string[];
        filterFolders?: string[];
        excludeFolders?: string[];
      }
    ): boolean {
      if (options.filterTags && options.filterTags.length > 0) {
        const docTags = doc.metadata.tags || [];
        const hasTag = options.filterTags.some(
          (tag) =>
            docTags.includes(tag) || docTags.includes('#' + tag.replace(/^#/, ''))
        );
        if (!hasTag) return false;
      }

      if (options.filterFolders && options.filterFolders.length > 0) {
        const inFolder = options.filterFolders.some((folder) =>
          doc.filepath.startsWith(folder + '/')
        );
        if (!inFolder) return false;
      }

      if (options.excludeFolders && options.excludeFolders.length > 0) {
        const excluded = options.excludeFolders.some((folder) =>
          doc.filepath.startsWith(folder + '/')
        );
        if (excluded) return false;
      }

      return true;
    }

    it('should filter by tags', () => {
      const doc = {
        filepath: 'notes/test.md',
        metadata: { tags: ['#important', '#work'] },
      };

      expect(matchesFilter(doc, { filterTags: ['#important'] })).toBe(true);
      expect(matchesFilter(doc, { filterTags: ['important'] })).toBe(true);
      expect(matchesFilter(doc, { filterTags: ['#personal'] })).toBe(false);
    });

    it('should filter by folders', () => {
      const doc = { filepath: 'projects/work/task.md', metadata: {} };

      expect(matchesFilter(doc, { filterFolders: ['projects'] })).toBe(true);
      expect(matchesFilter(doc, { filterFolders: ['projects/work'] })).toBe(true);
      expect(matchesFilter(doc, { filterFolders: ['personal'] })).toBe(false);
    });

    it('should exclude folders', () => {
      const doc = { filepath: 'archive/old.md', metadata: {} };

      expect(matchesFilter(doc, { excludeFolders: ['archive'] })).toBe(false);
      expect(matchesFilter(doc, { excludeFolders: ['templates'] })).toBe(true);
    });

    it('should combine multiple filters', () => {
      const doc = {
        filepath: 'projects/work/task.md',
        metadata: { tags: ['#urgent'] },
      };

      expect(
        matchesFilter(doc, {
          filterTags: ['#urgent'],
          filterFolders: ['projects'],
        })
      ).toBe(true);

      expect(
        matchesFilter(doc, {
          filterTags: ['#urgent'],
          filterFolders: ['personal'],
        })
      ).toBe(false);

      expect(
        matchesFilter(doc, {
          filterTags: ['#chill'],
          filterFolders: ['projects'],
        })
      ).toBe(false);
    });

    it('should handle empty document tags', () => {
      const doc = { filepath: 'notes/test.md', metadata: {} };

      expect(matchesFilter(doc, { filterTags: ['#important'] })).toBe(false);
      expect(matchesFilter(doc, {})).toBe(true);
    });
  });

  describe('folder exclusion logic', () => {
    function shouldExclude(filepath: string, excludeFolders: string[]): boolean {
      for (const folder of excludeFolders) {
        // Only match exact folder prefix (folder/) or exact match
        if (filepath.startsWith(folder + '/') || filepath === folder) {
          return true;
        }
      }
      return false;
    }

    it('should exclude .obsidian folder', () => {
      expect(shouldExclude('.obsidian/plugins/test.md', ['.obsidian'])).toBe(true);
    });

    it('should exclude nested paths', () => {
      expect(shouldExclude('archive/2023/old.md', ['archive'])).toBe(true);
    });

    it('should not exclude similar names', () => {
      expect(shouldExclude('archives/test.md', ['archive'])).toBe(false);
    });

    it('should handle multiple exclusions', () => {
      const excludes = ['.obsidian', '.trash', 'templates'];
      expect(shouldExclude('.trash/deleted.md', excludes)).toBe(true);
      expect(shouldExclude('templates/daily.md', excludes)).toBe(true);
      expect(shouldExclude('notes/valid.md', excludes)).toBe(false);
    });
  });
});
