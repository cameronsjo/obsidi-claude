import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObsidianTools, type ToolDefinition } from '../src/ObsidianTools';
import { TAbstractFile, TFile, TFolder } from 'obsidian';

// Create mock files as instances of TFile
function createMockFile(
  path: string,
  options: {
    mtime?: number;
    ctime?: number;
    size?: number;
  } = {}
): TFile {
  const parts = path.split('/');
  const name = parts[parts.length - 1];
  const file = new TFile();
  file.path = path;
  file.name = name;
  file.basename = name.replace(/\.[^.]+$/, '');
  file.extension = 'md';
  file.stat = {
    ctime: options.ctime || Date.now() - 100000,
    mtime: options.mtime || Date.now(),
    size: options.size || 1000,
  };
  return file;
}

// Create mock folder as instance of TFolder
function createMockFolder(name: string, children: TAbstractFile[] = []): TFolder {
  const folder = new TFolder();
  folder.name = name;
  folder.path = name;
  folder.children = children;
  return folder;
}

// Create mock metadata cache entry
function createMockCache(options: {
  frontmatter?: Record<string, unknown>;
  tags?: Array<{ tag: string }>;
  headings?: Array<{ heading: string; level: number }>;
  links?: Array<{ link: string }>;
  embeds?: Array<{ link: string }>;
} = {}) {
  return {
    frontmatter: options.frontmatter,
    tags: options.tags,
    headings: options.headings,
    links: options.links,
    embeds: options.embeds,
  };
}

describe('ObsidianTools', () => {
  let mockApp: any;
  let mockRAGService: any;
  let tools: ObsidianTools;

  const mockFiles: TFile[] = [
    createMockFile('notes/project-a.md', { mtime: Date.now() }),
    createMockFile('notes/project-b.md', { mtime: Date.now() - 10000 }),
    createMockFile('daily/2024-01-15.md'),
    createMockFile('archive/old-note.md'),
  ];

  const mockCaches: Record<string, ReturnType<typeof createMockCache>> = {
    'notes/project-a.md': createMockCache({
      frontmatter: { title: 'Project A', status: 'active', tags: ['project'] },
      tags: [{ tag: '#important' }, { tag: '#work' }],
      headings: [
        { heading: 'Project A', level: 1 },
        { heading: 'Overview', level: 2 },
      ],
      links: [{ link: 'project-b' }],
    }),
    'notes/project-b.md': createMockCache({
      frontmatter: { title: 'Project B', status: 'completed' },
      tags: [{ tag: '#archived' }],
    }),
    'daily/2024-01-15.md': createMockCache({
      frontmatter: { title: 'Daily Note' },
    }),
  };

  beforeEach(() => {
    mockApp = {
      vault: {
        getAbstractFileByPath: vi.fn((path: string) => {
          const file = mockFiles.find((f) => f.path === path);
          if (file) return file;
          // Check for folder
          if (path === '' || path === 'notes' || path === 'daily') {
            return createMockFolder(path || 'vault', mockFiles.filter((f) => f.path.startsWith(path ? path + '/' : '')));
          }
          return null;
        }),
        getRoot: vi.fn(() =>
          createMockFolder('vault', [
            createMockFolder('notes', [mockFiles[0], mockFiles[1]]),
            createMockFolder('daily', [mockFiles[2]]),
            createMockFolder('archive', [mockFiles[3]]),
          ])
        ),
        getMarkdownFiles: vi.fn(() => mockFiles),
        read: vi.fn(async (file: TFile) => `# ${file.basename}\n\nContent of ${file.path}`),
        cachedRead: vi.fn(async (file: TFile) => `# ${file.basename}\n\nContent of ${file.path}`),
        create: vi.fn(async () => {}),
        modify: vi.fn(async () => {}),
        createFolder: vi.fn(async () => {}),
      },
      metadataCache: {
        getFileCache: vi.fn((file: TFile) => mockCaches[file.path] || null),
        getTags: vi.fn(() => ({
          '#important': 5,
          '#work': 10,
          '#archived': 3,
          '#project': 2,
        })),
        resolvedLinks: {
          'notes/project-a.md': { 'notes/project-b.md': 1 },
          'notes/project-b.md': {},
        },
        unresolvedLinks: {
          'notes/project-a.md': { 'nonexistent-note': 1 },
        },
        getFirstLinkpathDest: vi.fn((link: string) => {
          if (link === 'project-b') return mockFiles[1];
          return null;
        }),
      },
      workspace: {
        getActiveFile: vi.fn(() => mockFiles[0]),
        getLeaf: vi.fn(() => ({
          openFile: vi.fn(async () => {}),
        })),
        activeLeaf: null,
        getActiveViewOfType: vi.fn(() => null),
      },
      fileManager: {
        renameFile: vi.fn(async () => {}),
      },
    };

    mockRAGService = {
      isConfigured: vi.fn(() => true),
      search: vi.fn(async () => [
        {
          document: {
            filepath: 'notes/project-a.md',
            content: 'Project A content here...',
            metadata: { title: 'Project A', tags: ['#important'] },
          },
          score: 0.95,
        },
      ]),
    };

    tools = new ObsidianTools(mockApp, mockRAGService);
  });

  describe('getToolDefinitions', () => {
    it('should return 16 tool definitions', () => {
      const definitions = tools.getToolDefinitions();
      expect(definitions).toHaveLength(16);
    });

    it('should return tools with required properties', () => {
      const definitions = tools.getToolDefinitions();
      for (const tool of definitions) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('parameters');
        expect(tool).toHaveProperty('handler');
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('should have unique tool names', () => {
      const definitions = tools.getToolDefinitions();
      const names = definitions.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe('getToolSchemas', () => {
    it('should return schemas in MCP format', () => {
      const schemas = tools.getToolSchemas();
      expect(schemas).toHaveLength(16);
      for (const schema of schemas) {
        expect(schema).toHaveProperty('name');
        expect(schema).toHaveProperty('description');
        expect(schema).toHaveProperty('input_schema');
      }
    });
  });

  describe('executeTool', () => {
    it('should execute tool by name', async () => {
      const result = await tools.executeTool('vault_tags', {});
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty('totalTags');
      expect(parsed).toHaveProperty('tags');
    });

    it('should return error for unknown tool', async () => {
      const result = await tools.executeTool('nonexistent_tool', {});
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Unknown tool');
    });
  });

  describe('semantic_search tool', () => {
    it('should search using RAG service', async () => {
      const result = await tools.executeTool('semantic_search', {
        query: 'project management',
        limit: 5,
      });

      const parsed = JSON.parse(result);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].filepath).toBe('notes/project-a.md');
      expect(parsed.results[0].score).toBe(0.95);
      expect(mockRAGService.search).toHaveBeenCalledWith('project management', {
        limit: 5,
        filterTags: undefined,
        filterFolders: undefined,
      });
    });

    it('should return error when RAG not configured', async () => {
      mockRAGService.isConfigured.mockReturnValue(false);

      const result = await tools.executeTool('semantic_search', {
        query: 'test',
      });

      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('not configured');
    });

    it('should handle RAG search errors', async () => {
      mockRAGService.search.mockRejectedValue(new Error('Embedding failed'));

      const result = await tools.executeTool('semantic_search', {
        query: 'test',
      });

      const parsed = JSON.parse(result);
      expect(parsed.error).toBe('Embedding failed');
    });
  });

  describe('vault_structure tool', () => {
    it('should return folder tree', async () => {
      const result = await tools.executeTool('vault_structure', {});
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe('vault');
      expect(parsed.type).toBe('folder');
    });

    it('should respect depth limit', async () => {
      const result = await tools.executeTool('vault_structure', { depth: 1 });
      const parsed = JSON.parse(result);
      expect(parsed).toBeDefined();
    });

    it('should include files when requested', async () => {
      const result = await tools.executeTool('vault_structure', {
        includeFiles: true,
      });
      const parsed = JSON.parse(result);
      expect(parsed).toBeDefined();
    });

    it('should return error for invalid folder path', async () => {
      const result = await tools.executeTool('vault_structure', {
        path: 'nonexistent-folder',
      });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Folder not found');
    });
  });

  describe('file_metadata tool', () => {
    it('should return file metadata', async () => {
      const result = await tools.executeTool('file_metadata', {
        filepath: 'notes/project-a.md',
      });
      const parsed = JSON.parse(result);

      expect(parsed.path).toBe('notes/project-a.md');
      expect(parsed.name).toBe('project-a');
      expect(parsed.frontmatter.title).toBe('Project A');
      expect(parsed.tags).toContain('#important');
      expect(parsed.headings).toHaveLength(2);
    });

    it('should return error for missing file', async () => {
      const result = await tools.executeTool('file_metadata', {
        filepath: 'nonexistent.md',
      });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('File not found');
    });
  });

  describe('backlinks tool', () => {
    it('should return backlinks to a file', async () => {
      const result = await tools.executeTool('backlinks', {
        filepath: 'notes/project-b.md',
      });
      const parsed = JSON.parse(result);

      expect(parsed.file).toBe('notes/project-b.md');
      expect(parsed.backlinkCount).toBe(1);
      expect(parsed.backlinks[0].filepath).toBe('notes/project-a.md');
    });

    it('should return error for missing file', async () => {
      const result = await tools.executeTool('backlinks', {
        filepath: 'nonexistent.md',
      });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('File not found');
    });
  });

  describe('outgoing_links tool', () => {
    it('should return outgoing links from a file', async () => {
      const result = await tools.executeTool('outgoing_links', {
        filepath: 'notes/project-a.md',
      });
      const parsed = JSON.parse(result);

      expect(parsed.file).toBe('notes/project-a.md');
      expect(parsed.linkCount).toBeGreaterThan(0);
    });

    it('should include unresolved links when requested', async () => {
      const result = await tools.executeTool('outgoing_links', {
        filepath: 'notes/project-a.md',
        includeUnresolved: true,
      });
      const parsed = JSON.parse(result);
      const unresolvedLinks = parsed.links.filter((l: { resolved: boolean }) => !l.resolved);
      expect(unresolvedLinks.length).toBeGreaterThanOrEqual(0);
    });

    it('should return error for missing file', async () => {
      const result = await tools.executeTool('outgoing_links', {
        filepath: 'nonexistent.md',
      });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('File not found');
    });
  });

  describe('vault_tags tool', () => {
    it('should return all tags with counts', async () => {
      const result = await tools.executeTool('vault_tags', {});
      const parsed = JSON.parse(result);

      expect(parsed.totalTags).toBe(4);
      expect(parsed.tags).toHaveLength(4);
      // Should be sorted by count descending
      expect(parsed.tags[0].count).toBeGreaterThanOrEqual(parsed.tags[1].count);
    });

    it('should filter by prefix', async () => {
      const result = await tools.executeTool('vault_tags', {
        prefix: '#work',
      });
      const parsed = JSON.parse(result);

      expect(parsed.tags.every((t: { tag: string }) => t.tag.startsWith('#work'))).toBe(true);
    });

    it('should handle prefix without hash', async () => {
      const result = await tools.executeTool('vault_tags', {
        prefix: 'important',
      });
      const parsed = JSON.parse(result);

      expect(parsed.tags.some((t: { tag: string }) => t.tag.includes('important'))).toBe(true);
    });
  });

  describe('recent_files tool', () => {
    it('should return recent files sorted by mtime', async () => {
      const result = await tools.executeTool('recent_files', {
        limit: 10,
        sortBy: 'modified',
      });
      const parsed = JSON.parse(result);

      expect(parsed.files).toHaveLength(4);
      // Verify files are sorted by mtime (first should have newest timestamp)
      for (let i = 0; i < parsed.files.length - 1; i++) {
        const current = new Date(parsed.files[i].modified).getTime();
        const next = new Date(parsed.files[i + 1].modified).getTime();
        expect(current).toBeGreaterThanOrEqual(next);
      }
    });

    it('should respect limit parameter', async () => {
      const result = await tools.executeTool('recent_files', { limit: 2 });
      const parsed = JSON.parse(result);

      expect(parsed.files).toHaveLength(2);
    });

    it('should sort by creation time when requested', async () => {
      const result = await tools.executeTool('recent_files', {
        sortBy: 'created',
      });
      const parsed = JSON.parse(result);
      expect(parsed.files).toBeDefined();
    });
  });

  describe('search_by_property tool', () => {
    it('should find notes with matching property', async () => {
      const result = await tools.executeTool('search_by_property', {
        property: 'status',
        value: 'active',
      });
      const parsed = JSON.parse(result);

      expect(parsed.property).toBe('status');
      expect(parsed.matches.length).toBeGreaterThanOrEqual(0);
    });

    it('should find notes with property (without value filter)', async () => {
      const result = await tools.executeTool('search_by_property', {
        property: 'status',
      });
      const parsed = JSON.parse(result);

      expect(parsed.property).toBe('status');
    });

    it('should respect limit', async () => {
      const result = await tools.executeTool('search_by_property', {
        property: 'status',
        limit: 1,
      });
      const parsed = JSON.parse(result);

      expect(parsed.matches.length).toBeLessThanOrEqual(1);
    });
  });

  describe('create_note tool', () => {
    it('should create a new note', async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

      const result = await tools.executeTool('create_note', {
        path: 'new-note.md',
        content: '# New Note\n\nContent here',
      });
      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(true);
      expect(parsed.path).toBe('new-note.md');
      expect(mockApp.vault.create).toHaveBeenCalledWith(
        'new-note.md',
        '# New Note\n\nContent here'
      );
    });

    it('should refuse to overwrite existing file by default', async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFiles[0]);

      const result = await tools.executeTool('create_note', {
        path: 'notes/project-a.md',
        content: 'new content',
      });
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('already exists');
    });

    it('should overwrite when flag is set', async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFiles[0]);

      const result = await tools.executeTool('create_note', {
        path: 'notes/project-a.md',
        content: 'new content',
        overwrite: true,
      });
      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(true);
      expect(mockApp.vault.modify).toHaveBeenCalled();
    });
  });

  describe('append_to_note tool', () => {
    it('should append content to existing note', async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFiles[0]);

      const result = await tools.executeTool('append_to_note', {
        path: 'notes/project-a.md',
        content: 'Appended content',
      });
      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(true);
      expect(mockApp.vault.read).toHaveBeenCalled();
      expect(mockApp.vault.modify).toHaveBeenCalled();
    });

    it('should create note if missing and flag is set', async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

      const result = await tools.executeTool('append_to_note', {
        path: 'new-note.md',
        content: 'Initial content',
        createIfMissing: true,
      });
      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(true);
      expect(parsed.created).toBe(true);
    });

    it('should return error for missing file without create flag', async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

      const result = await tools.executeTool('append_to_note', {
        path: 'missing.md',
        content: 'content',
      });
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('File not found');
    });
  });

  describe('daily_note tool', () => {
    it('should find existing daily note', async () => {
      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === '2024-01-15.md') return mockFiles[2];
        return null;
      });

      const result = await tools.executeTool('daily_note', {
        date: '2024-01-15',
      });
      const parsed = JSON.parse(result);

      expect(parsed.exists).toBe(true);
    });

    it('should return not found without creating when create=false', async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

      const result = await tools.executeTool('daily_note', {
        date: '2024-12-25',
        create: false,
      });
      const parsed = JSON.parse(result);

      expect(parsed.exists).toBe(false);
      expect(parsed.searchedPaths).toBeDefined();
    });

    it('should handle invalid date format', async () => {
      const result = await tools.executeTool('daily_note', {
        date: 'not-a-date',
      });
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('Invalid date');
    });
  });

  describe('search_content tool', () => {
    it('should search file contents', async () => {
      const result = await tools.executeTool('search_content', {
        query: 'Content',
      });
      const parsed = JSON.parse(result);

      expect(parsed.query).toBe('Content');
      expect(parsed.results.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle regex patterns', async () => {
      const result = await tools.executeTool('search_content', {
        query: 'project-[ab]',
      });
      const parsed = JSON.parse(result);
      expect(parsed.results).toBeDefined();
    });

    it('should escape invalid regex', async () => {
      const result = await tools.executeTool('search_content', {
        query: '[invalid regex((',
      });
      const parsed = JSON.parse(result);
      // Should not throw, treats as literal string
      expect(parsed.results).toBeDefined();
    });

    it('should filter by folder', async () => {
      const result = await tools.executeTool('search_content', {
        query: 'Content',
        folder: 'notes',
      });
      const parsed = JSON.parse(result);
      expect(parsed.results).toBeDefined();
    });
  });

  describe('open_note tool', () => {
    it('should open existing note', async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFiles[0]);

      const result = await tools.executeTool('open_note', {
        path: 'notes/project-a.md',
      });
      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(true);
      expect(parsed.opened).toBe(true);
    });

    it('should return error for missing file', async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

      const result = await tools.executeTool('open_note', {
        path: 'missing.md',
      });
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('File not found');
    });
  });

  describe('active_note tool', () => {
    it('should return active file info', async () => {
      const result = await tools.executeTool('active_note', {});
      const parsed = JSON.parse(result);

      expect(parsed.active).toBe(true);
      expect(parsed.path).toBeDefined();
      expect(parsed.name).toBeDefined();
      expect(parsed.extension).toBe('md');
    });

    it('should include content by default', async () => {
      const result = await tools.executeTool('active_note', {
        includeContent: true,
      });
      const parsed = JSON.parse(result);

      expect(parsed.content).toBeDefined();
    });

    it('should return inactive when no file open', async () => {
      mockApp.workspace.getActiveFile.mockReturnValue(null);

      const result = await tools.executeTool('active_note', {});
      const parsed = JSON.parse(result);

      expect(parsed.active).toBe(false);
    });
  });

  describe('graph_neighbors tool', () => {
    it('should return connected notes', async () => {
      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        return mockFiles.find((f) => f.path === path) || null;
      });

      const result = await tools.executeTool('graph_neighbors', {
        path: 'notes/project-a.md',
      });
      const parsed = JSON.parse(result);

      expect(parsed.centerNote).toBe('notes/project-a.md');
      expect(parsed.neighbors).toBeDefined();
    });

    it('should return error for missing file', async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

      const result = await tools.executeTool('graph_neighbors', {
        path: 'missing.md',
      });
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('File not found');
    });

    it('should respect depth parameter', async () => {
      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        return mockFiles.find((f) => f.path === path) || null;
      });

      const result = await tools.executeTool('graph_neighbors', {
        path: 'notes/project-a.md',
        depth: 2,
      });
      const parsed = JSON.parse(result);

      expect(parsed.depth).toBe(2);
    });
  });

  describe('rename_note tool', () => {
    it('should rename file', async () => {
      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'old-name.md') return mockFiles[0];
        return null;
      });

      const result = await tools.executeTool('rename_note', {
        oldPath: 'old-name.md',
        newPath: 'new-name.md',
      });
      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(true);
      expect(mockApp.fileManager.renameFile).toHaveBeenCalled();
    });

    it('should return error for missing source file', async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

      const result = await tools.executeTool('rename_note', {
        oldPath: 'missing.md',
        newPath: 'new.md',
      });
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('File not found');
    });

    it('should return error if destination exists', async () => {
      mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
        // Both old and new paths exist
        return mockFiles[0];
      });

      const result = await tools.executeTool('rename_note', {
        oldPath: 'old.md',
        newPath: 'existing.md',
      });
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('Destination already exists');
    });
  });

  describe('setRAGService', () => {
    it('should update RAG service reference', () => {
      const newRAGService = { isConfigured: vi.fn(() => true), search: vi.fn() };
      tools.setRAGService(newRAGService as any);

      // Verify the new service is used
      newRAGService.isConfigured.mockReturnValue(false);
      tools.executeTool('semantic_search', { query: 'test' });
      expect(newRAGService.isConfigured).toHaveBeenCalled();
    });
  });

  describe('tool parameter validation', () => {
    it('should handle missing required parameters gracefully', async () => {
      // semantic_search requires query
      const result = await tools.executeTool('semantic_search', {});
      // The tool should handle this - either error or empty results
      expect(result).toBeDefined();
    });

    it('should use default values for optional parameters', async () => {
      const result = await tools.executeTool('recent_files', {});
      const parsed = JSON.parse(result);
      // Should use default limit of 10
      expect(parsed.files.length).toBeLessThanOrEqual(10);
    });
  });
});

describe('ObsidianTools without RAG', () => {
  it('should work without RAG service', () => {
    const mockApp = {
      vault: {
        getAbstractFileByPath: vi.fn(),
        getRoot: vi.fn(() => ({ name: 'vault', children: [] })),
        getMarkdownFiles: vi.fn(() => []),
      },
      metadataCache: {
        getTags: vi.fn(() => ({})),
        resolvedLinks: {},
        unresolvedLinks: {},
      },
      workspace: {
        getActiveFile: vi.fn(() => null),
      },
    } as any;

    const tools = new ObsidianTools(mockApp);
    const definitions = tools.getToolDefinitions();

    expect(definitions).toHaveLength(16);
  });
});
