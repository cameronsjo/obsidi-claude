import type { App, TFile, TFolder, CachedMetadata } from 'obsidian';
import { TAbstractFile } from 'obsidian';
import type { RAGService } from './RAGService';

/**
 * Tool definitions that can be exposed to Claude via MCP or custom handlers
 * These wrap Obsidian's APIs in a way that's useful for AI assistants
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<string>;
}

/**
 * Creates Obsidian-specific tools that Claude can use
 */
export class ObsidianTools {
  private app: App;
  private ragService: RAGService | null;

  constructor(app: App, ragService?: RAGService) {
    this.app = app;
    this.ragService = ragService || null;
  }

  setRAGService(ragService: RAGService): void {
    this.ragService = ragService;
  }

  /**
   * Get all tool definitions
   */
  getToolDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = [
      this.getSemanticSearchTool(),
      this.getVaultStructureTool(),
      this.getFileMetadataTool(),
      this.getBacklinksTool(),
      this.getOutgoingLinksTool(),
      this.getTagsTool(),
      this.getRecentFilesTool(),
      this.getSearchByPropertyTool(),
      this.getCreateNoteTool(),
      this.getAppendToNoteTool(),
      this.getDailyNoteTool(),
      this.getSearchContentTool(),
      this.getOpenNoteTool(),
      this.getActiveNoteTool(),
      this.getGraphNeighborsTool(),
      this.getRenameNoteTool(),
    ];

    return tools;
  }

  /**
   * Semantic search using RAG
   */
  private getSemanticSearchTool(): ToolDefinition {
    return {
      name: 'semantic_search',
      description:
        'Search the vault for notes semantically similar to the query. Returns relevant chunks of text with similarity scores. Use this to find notes about a topic even if they don\'t contain exact keywords.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query describing what you\'re looking for',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 5)',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: filter results to notes with these tags',
          },
          folders: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: filter results to notes in these folders',
          },
        },
        required: ['query'],
      },
      handler: async (params) => {
        if (!this.ragService || !this.ragService.isConfigured()) {
          return JSON.stringify({
            error: 'Semantic search is not configured. Enable embeddings in settings.',
          });
        }

        try {
          const results = await this.ragService.search(params.query as string, {
            limit: (params.limit as number) || 5,
            filterTags: params.tags as string[] | undefined,
            filterFolders: params.folders as string[] | undefined,
          });

          return JSON.stringify({
            results: results.map((r) => ({
              filepath: r.document.filepath,
              title: r.document.metadata.title,
              score: Math.round(r.score * 100) / 100,
              excerpt: r.document.content.slice(0, 500),
              tags: r.document.metadata.tags,
            })),
          });
        } catch (error) {
          return JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    };
  }

  /**
   * Get vault folder structure
   */
  private getVaultStructureTool(): ToolDefinition {
    return {
      name: 'vault_structure',
      description:
        'Get the folder structure of the vault. Use this to understand how notes are organized.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Optional: path to start from (default: root)',
          },
          depth: {
            type: 'number',
            description: 'Maximum depth to traverse (default: 3)',
          },
          includeFiles: {
            type: 'boolean',
            description: 'Include file names in output (default: false)',
          },
        },
      },
      handler: async (params) => {
        const startPath = (params.path as string) || '';
        const maxDepth = (params.depth as number) || 3;
        const includeFiles = (params.includeFiles as boolean) || false;

        interface TreeNode {
          name: string;
          type: 'folder' | 'file';
          children?: TreeNode[];
          fileCount?: number;
        }

        const buildTree = (
          folder: TFolder,
          depth: number
        ): TreeNode | null => {
          if (depth > maxDepth) return null;

          const children: TreeNode[] = [];
          let fileCount = 0;

          for (const child of folder.children) {
            if (child instanceof TAbstractFile) {
              if ('children' in child) {
                // It's a folder
                const subTree = buildTree(child as TFolder, depth + 1);
                if (subTree) children.push(subTree);
              } else {
                // It's a file
                fileCount++;
                if (includeFiles && child.name.endsWith('.md')) {
                  children.push({
                    name: child.name,
                    type: 'file',
                  });
                }
              }
            }
          }

          return {
            name: folder.name || 'vault',
            type: 'folder',
            children: children.length > 0 ? children : undefined,
            fileCount: includeFiles ? undefined : fileCount,
          };
        };

        let startFolder: TFolder;
        if (startPath) {
          const abstractFile = this.app.vault.getAbstractFileByPath(startPath);
          if (!abstractFile || !('children' in abstractFile)) {
            return JSON.stringify({ error: `Folder not found: ${startPath}` });
          }
          startFolder = abstractFile as TFolder;
        } else {
          startFolder = this.app.vault.getRoot();
        }

        const tree = buildTree(startFolder, 0);
        return JSON.stringify(tree, null, 2);
      },
    };
  }

  /**
   * Get file metadata
   */
  private getFileMetadataTool(): ToolDefinition {
    return {
      name: 'file_metadata',
      description:
        'Get metadata for a specific file including frontmatter, tags, headings, and links.',
      parameters: {
        type: 'object',
        properties: {
          filepath: {
            type: 'string',
            description: 'Path to the file (e.g., "folder/note.md")',
          },
        },
        required: ['filepath'],
      },
      handler: async (params) => {
        const filepath = params.filepath as string;
        const file = this.app.vault.getAbstractFileByPath(filepath);

        if (!file || !(file instanceof TAbstractFile) || !('extension' in file)) {
          return JSON.stringify({ error: `File not found: ${filepath}` });
        }

        const tfile = file as TFile;
        const cache = this.app.metadataCache.getFileCache(tfile);

        const metadata = {
          path: tfile.path,
          name: tfile.basename,
          extension: tfile.extension,
          created: tfile.stat.ctime,
          modified: tfile.stat.mtime,
          size: tfile.stat.size,
          frontmatter: cache?.frontmatter || {},
          tags: cache?.tags?.map((t) => t.tag) || [],
          headings:
            cache?.headings?.map((h) => ({
              level: h.level,
              text: h.heading,
            })) || [],
          links: cache?.links?.map((l) => l.link) || [],
          embeds: cache?.embeds?.map((e) => e.link) || [],
        };

        return JSON.stringify(metadata, null, 2);
      },
    };
  }

  /**
   * Get backlinks to a file
   */
  private getBacklinksTool(): ToolDefinition {
    return {
      name: 'backlinks',
      description:
        'Get all notes that link TO a specific file. Useful for understanding how a note is connected in the knowledge graph.',
      parameters: {
        type: 'object',
        properties: {
          filepath: {
            type: 'string',
            description: 'Path to the file to find backlinks for',
          },
        },
        required: ['filepath'],
      },
      handler: async (params) => {
        const filepath = params.filepath as string;
        const file = this.app.vault.getAbstractFileByPath(filepath);

        if (!file) {
          return JSON.stringify({ error: `File not found: ${filepath}` });
        }

        const backlinks: Array<{
          filepath: string;
          title: string;
          linkText: string;
        }> = [];

        // Get resolved links from metadata cache
        const resolvedLinks = this.app.metadataCache.resolvedLinks;

        for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
          if (links[filepath]) {
            const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
            if (sourceFile && 'basename' in sourceFile) {
              const sourceCache = this.app.metadataCache.getFileCache(
                sourceFile as TFile
              );
              const title =
                (sourceCache?.frontmatter?.title as string) ||
                (sourceFile as TFile).basename;

              backlinks.push({
                filepath: sourcePath,
                title,
                linkText: `[[${filepath.replace(/\.md$/, '')}]]`,
              });
            }
          }
        }

        return JSON.stringify({
          file: filepath,
          backlinkCount: backlinks.length,
          backlinks,
        });
      },
    };
  }

  /**
   * Get outgoing links from a file
   */
  private getOutgoingLinksTool(): ToolDefinition {
    return {
      name: 'outgoing_links',
      description:
        'Get all links FROM a specific file to other notes. Shows what topics this note references.',
      parameters: {
        type: 'object',
        properties: {
          filepath: {
            type: 'string',
            description: 'Path to the file to find outgoing links for',
          },
          includeUnresolved: {
            type: 'boolean',
            description: 'Include links to notes that don\'t exist yet (default: false)',
          },
        },
        required: ['filepath'],
      },
      handler: async (params) => {
        const filepath = params.filepath as string;
        const includeUnresolved = (params.includeUnresolved as boolean) || false;

        const file = this.app.vault.getAbstractFileByPath(filepath);
        if (!file || !('extension' in file)) {
          return JSON.stringify({ error: `File not found: ${filepath}` });
        }

        const cache = this.app.metadataCache.getFileCache(file as TFile);
        const resolvedLinks = this.app.metadataCache.resolvedLinks[filepath] || {};
        const unresolvedLinks =
          this.app.metadataCache.unresolvedLinks[filepath] || {};

        const links: Array<{
          link: string;
          resolved: boolean;
          targetPath?: string;
        }> = [];

        // Add resolved links
        for (const targetPath of Object.keys(resolvedLinks)) {
          const linkInfo = cache?.links?.find((l) => {
            const resolved = this.app.metadataCache.getFirstLinkpathDest(
              l.link,
              filepath
            );
            return resolved?.path === targetPath;
          });
          links.push({
            link: linkInfo?.link || targetPath,
            resolved: true,
            targetPath,
          });
        }

        // Add unresolved links
        if (includeUnresolved) {
          for (const link of Object.keys(unresolvedLinks)) {
            links.push({
              link,
              resolved: false,
            });
          }
        }

        return JSON.stringify({
          file: filepath,
          linkCount: links.length,
          links,
        });
      },
    };
  }

  /**
   * Get all tags in the vault
   */
  private getTagsTool(): ToolDefinition {
    return {
      name: 'vault_tags',
      description:
        'Get all tags used in the vault with their usage counts. Use this to understand the tagging taxonomy.',
      parameters: {
        type: 'object',
        properties: {
          prefix: {
            type: 'string',
            description: 'Optional: filter to tags starting with this prefix (e.g., "#project")',
          },
        },
      },
      handler: async (params) => {
        const prefix = params.prefix as string | undefined;
        const allTags = (this.app.metadataCache as unknown as { getTags(): Record<string, number> }).getTags();

        let tags = Object.entries(allTags).map(([tag, count]) => ({
          tag,
          count,
        }));

        if (prefix) {
          const normalizedPrefix = prefix.startsWith('#') ? prefix : '#' + prefix;
          tags = tags.filter((t) =>
            t.tag.toLowerCase().startsWith(normalizedPrefix.toLowerCase())
          );
        }

        // Sort by count descending
        tags.sort((a, b) => b.count - a.count);

        return JSON.stringify({
          totalTags: tags.length,
          tags: tags.slice(0, 100), // Limit to top 100
        });
      },
    };
  }

  /**
   * Get recently modified files
   */
  private getRecentFilesTool(): ToolDefinition {
    return {
      name: 'recent_files',
      description:
        'Get recently modified or created files. Useful for understanding what the user has been working on.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of files to return (default: 10)',
          },
          sortBy: {
            type: 'string',
            enum: ['modified', 'created'],
            description: 'Sort by modification time or creation time (default: modified)',
          },
        },
      },
      handler: async (params) => {
        const limit = (params.limit as number) || 10;
        const sortBy = (params.sortBy as string) || 'modified';

        const files = this.app.vault.getMarkdownFiles();
        const sorted = files.sort((a, b) => {
          const timeA = sortBy === 'created' ? a.stat.ctime : a.stat.mtime;
          const timeB = sortBy === 'created' ? b.stat.ctime : b.stat.mtime;
          return timeB - timeA;
        });

        const result = sorted.slice(0, limit).map((file) => {
          const cache = this.app.metadataCache.getFileCache(file);
          return {
            path: file.path,
            name: file.basename,
            modified: new Date(file.stat.mtime).toISOString(),
            created: new Date(file.stat.ctime).toISOString(),
            title: (cache?.frontmatter?.title as string) || file.basename,
            tags: cache?.tags?.map((t) => t.tag) || [],
          };
        });

        return JSON.stringify({ files: result });
      },
    };
  }

  /**
   * Search notes by frontmatter property
   */
  private getSearchByPropertyTool(): ToolDefinition {
    return {
      name: 'search_by_property',
      description:
        'Find notes that have a specific frontmatter property with a given value. Useful for finding notes by status, type, project, etc.',
      parameters: {
        type: 'object',
        properties: {
          property: {
            type: 'string',
            description: 'The frontmatter property name to search (e.g., "status", "type", "project")',
          },
          value: {
            type: 'string',
            description: 'The value to match (case-insensitive partial match)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 20)',
          },
        },
        required: ['property'],
      },
      handler: async (params) => {
        const property = params.property as string;
        const value = (params.value as string | undefined)?.toLowerCase();
        const limit = (params.limit as number) || 20;

        const files = this.app.vault.getMarkdownFiles();
        const matches: Array<{
          path: string;
          title: string;
          propertyValue: unknown;
        }> = [];

        for (const file of files) {
          if (matches.length >= limit) break;

          const cache = this.app.metadataCache.getFileCache(file);
          const frontmatter = cache?.frontmatter;

          if (!frontmatter || !(property in frontmatter)) continue;

          const propValue = frontmatter[property];

          // Check if value matches (if value filter provided)
          if (value) {
            const propStr = String(propValue).toLowerCase();
            if (!propStr.includes(value)) continue;
          }

          matches.push({
            path: file.path,
            title: (frontmatter.title as string) || file.basename,
            propertyValue: propValue,
          });
        }

        return JSON.stringify({
          property,
          searchValue: value,
          matchCount: matches.length,
          matches,
        });
      },
    };
  }

  /**
   * Create a new note
   */
  private getCreateNoteTool(): ToolDefinition {
    return {
      name: 'create_note',
      description:
        'Create a new note in the vault. Returns the path of the created note.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path for the new note (e.g., "folder/note-name.md")',
          },
          content: {
            type: 'string',
            description: 'Content for the note (markdown)',
          },
          overwrite: {
            type: 'boolean',
            description: 'Overwrite if file exists (default: false)',
          },
        },
        required: ['path', 'content'],
      },
      handler: async (params) => {
        const filepath = params.path as string;
        const content = params.content as string;
        const overwrite = (params.overwrite as boolean) || false;

        // Check if file exists
        const existing = this.app.vault.getAbstractFileByPath(filepath);
        if (existing && !overwrite) {
          return JSON.stringify({
            error: `File already exists: ${filepath}. Use overwrite: true to replace.`,
          });
        }

        try {
          if (existing && overwrite) {
            await this.app.vault.modify(existing as TFile, content);
          } else {
            await this.app.vault.create(filepath, content);
          }
          return JSON.stringify({
            success: true,
            path: filepath,
            message: overwrite && existing ? 'File overwritten' : 'File created',
          });
        } catch (error) {
          return JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    };
  }

  /**
   * Append content to an existing note
   */
  private getAppendToNoteTool(): ToolDefinition {
    return {
      name: 'append_to_note',
      description:
        'Append content to the end of an existing note. Optionally add under a specific heading.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the note',
          },
          content: {
            type: 'string',
            description: 'Content to append',
          },
          heading: {
            type: 'string',
            description: 'Optional: heading to append under (creates if not exists)',
          },
          createIfMissing: {
            type: 'boolean',
            description: 'Create the note if it doesn\'t exist (default: false)',
          },
        },
        required: ['path', 'content'],
      },
      handler: async (params) => {
        const filepath = params.path as string;
        const content = params.content as string;
        const heading = params.heading as string | undefined;
        const createIfMissing = (params.createIfMissing as boolean) || false;

        let file = this.app.vault.getAbstractFileByPath(filepath);

        if (!file) {
          if (createIfMissing) {
            const initialContent = heading ? `# ${heading}\n\n${content}` : content;
            await this.app.vault.create(filepath, initialContent);
            return JSON.stringify({ success: true, path: filepath, created: true });
          }
          return JSON.stringify({ error: `File not found: ${filepath}` });
        }

        if (!(file instanceof TAbstractFile) || !('extension' in file)) {
          return JSON.stringify({ error: `Not a file: ${filepath}` });
        }

        try {
          const tfile = file as TFile;
          let existingContent = await this.app.vault.read(tfile);

          if (heading) {
            // Find the heading and append after its section
            const headingPattern = new RegExp(
              `^(#{1,6})\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
              'm'
            );
            const match = existingContent.match(headingPattern);

            if (match) {
              const headingLevel = match[1].length;
              const insertPos = match.index! + match[0].length;

              // Find next heading of same or higher level
              const afterHeading = existingContent.slice(insertPos);
              const nextHeadingMatch = afterHeading.match(
                new RegExp(`^#{1,${headingLevel}}\\s+`, 'm')
              );

              if (nextHeadingMatch) {
                const insertAt = insertPos + nextHeadingMatch.index!;
                existingContent =
                  existingContent.slice(0, insertAt) +
                  '\n' + content + '\n\n' +
                  existingContent.slice(insertAt);
              } else {
                existingContent += '\n\n' + content;
              }
            } else {
              // Heading doesn't exist, add it at the end
              existingContent += `\n\n## ${heading}\n\n${content}`;
            }
          } else {
            existingContent += '\n\n' + content;
          }

          await this.app.vault.modify(tfile, existingContent);
          return JSON.stringify({ success: true, path: filepath });
        } catch (error) {
          return JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    };
  }

  /**
   * Get or create today's daily note
   */
  private getDailyNoteTool(): ToolDefinition {
    return {
      name: 'daily_note',
      description:
        'Get today\'s daily note path and content. Creates it if it doesn\'t exist using the configured daily note format.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Optional: specific date in YYYY-MM-DD format (default: today)',
          },
          create: {
            type: 'boolean',
            description: 'Create if doesn\'t exist (default: true)',
          },
        },
      },
      handler: async (params) => {
        const dateStr = (params.date as string) || new Date().toISOString().split('T')[0];
        const shouldCreate = params.create !== false;

        // Parse date
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) {
          return JSON.stringify({ error: `Invalid date: ${dateStr}` });
        }

        // Format: YYYY-MM-DD by default, could read from daily notes plugin config
        const filename = `${dateStr}.md`;
        // Check common daily note locations
        const possiblePaths = [
          filename,
          `Daily/${filename}`,
          `daily/${filename}`,
          `Daily Notes/${filename}`,
          `Journals/${filename}`,
          `journal/${filename}`,
        ];

        let foundPath: string | null = null;
        let foundFile: TFile | null = null;

        for (const path of possiblePaths) {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file && 'extension' in file) {
            foundPath = path;
            foundFile = file as TFile;
            break;
          }
        }

        if (foundFile) {
          const content = await this.app.vault.cachedRead(foundFile);
          return JSON.stringify({
            path: foundPath,
            exists: true,
            content: content.slice(0, 2000), // Truncate for response
            truncated: content.length > 2000,
          });
        }

        if (!shouldCreate) {
          return JSON.stringify({
            exists: false,
            message: `No daily note found for ${dateStr}`,
            searchedPaths: possiblePaths,
          });
        }

        // Create in first existing parent folder
        let createPath = filename;
        for (const path of possiblePaths) {
          const folder = path.split('/').slice(0, -1).join('/');
          if (!folder || this.app.vault.getAbstractFileByPath(folder)) {
            createPath = path;
            break;
          }
        }

        const template = `# ${date.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}\n\n`;

        try {
          await this.app.vault.create(createPath, template);
          return JSON.stringify({
            path: createPath,
            exists: false,
            created: true,
            content: template,
          });
        } catch (error) {
          return JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    };
  }

  /**
   * Full-text search (keyword-based)
   */
  private getSearchContentTool(): ToolDefinition {
    return {
      name: 'search_content',
      description:
        'Search for text across all notes (keyword/regex search). Complements semantic_search for exact matches.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (supports regex)',
          },
          caseSensitive: {
            type: 'boolean',
            description: 'Case-sensitive search (default: false)',
          },
          limit: {
            type: 'number',
            description: 'Maximum results (default: 20)',
          },
          folder: {
            type: 'string',
            description: 'Optional: limit search to folder',
          },
        },
        required: ['query'],
      },
      handler: async (params) => {
        const query = params.query as string;
        const caseSensitive = (params.caseSensitive as boolean) || false;
        const limit = (params.limit as number) || 20;
        const folder = params.folder as string | undefined;

        const flags = caseSensitive ? 'g' : 'gi';
        let regex: RegExp;
        try {
          regex = new RegExp(query, flags);
        } catch {
          // If invalid regex, escape and try as literal
          regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
        }

        const files = this.app.vault.getMarkdownFiles();
        const results: Array<{
          path: string;
          title: string;
          matches: Array<{ line: number; text: string }>;
          matchCount: number;
        }> = [];

        for (const file of files) {
          if (results.length >= limit) break;
          if (folder && !file.path.startsWith(folder + '/')) continue;

          const content = await this.app.vault.cachedRead(file);
          const lines = content.split('\n');
          const matches: Array<{ line: number; text: string }> = [];

          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              matches.push({
                line: i + 1,
                text: lines[i].slice(0, 200),
              });
              if (matches.length >= 5) break; // Max 5 matches per file
            }
            regex.lastIndex = 0; // Reset regex state
          }

          if (matches.length > 0) {
            const cache = this.app.metadataCache.getFileCache(file);
            results.push({
              path: file.path,
              title: (cache?.frontmatter?.title as string) || file.basename,
              matches,
              matchCount: (content.match(regex) || []).length,
            });
          }
        }

        return JSON.stringify({
          query,
          resultCount: results.length,
          results,
        });
      },
    };
  }

  /**
   * Open a note in the editor
   */
  private getOpenNoteTool(): ToolDefinition {
    return {
      name: 'open_note',
      description: 'Open a note in the Obsidian editor for the user to view/edit.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the note to open',
          },
          newLeaf: {
            type: 'boolean',
            description: 'Open in new pane (default: false)',
          },
          line: {
            type: 'number',
            description: 'Optional: scroll to specific line',
          },
        },
        required: ['path'],
      },
      handler: async (params) => {
        const filepath = params.path as string;
        const newLeaf = (params.newLeaf as boolean) || false;
        const line = params.line as number | undefined;

        const file = this.app.vault.getAbstractFileByPath(filepath);
        if (!file || !('extension' in file)) {
          return JSON.stringify({ error: `File not found: ${filepath}` });
        }

        try {
          const leaf = this.app.workspace.getLeaf(newLeaf);
          await leaf.openFile(file as TFile);

          if (line !== undefined) {
            // Scroll to line after a short delay
            setTimeout(() => {
              const view = this.app.workspace.getActiveViewOfType(
                // Using any since MarkdownView isn't imported
                this.app.workspace.activeLeaf?.view?.constructor as unknown as new () => unknown
              );
              if (view && 'editor' in (view as Record<string, unknown>)) {
                const editor = (view as Record<string, unknown>).editor as {
                  setCursor: (pos: { line: number; ch: number }) => void;
                  scrollIntoView: (range: { from: { line: number }; to: { line: number } }) => void;
                };
                editor.setCursor({ line: line - 1, ch: 0 });
                editor.scrollIntoView({ from: { line: line - 1 }, to: { line: line - 1 } });
              }
            }, 100);
          }

          return JSON.stringify({
            success: true,
            path: filepath,
            opened: true,
          });
        } catch (error) {
          return JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    };
  }

  /**
   * Get the currently active note
   */
  private getActiveNoteTool(): ToolDefinition {
    return {
      name: 'active_note',
      description:
        'Get information about the currently open/active note including its content.',
      parameters: {
        type: 'object',
        properties: {
          includeContent: {
            type: 'boolean',
            description: 'Include full note content (default: true)',
          },
          maxContentLength: {
            type: 'number',
            description: 'Max content length to return (default: 5000)',
          },
        },
      },
      handler: async (params) => {
        const includeContent = params.includeContent !== false;
        const maxLength = (params.maxContentLength as number) || 5000;

        const file = this.app.workspace.getActiveFile();
        if (!file) {
          return JSON.stringify({
            active: false,
            message: 'No file is currently open',
          });
        }

        const cache = this.app.metadataCache.getFileCache(file);
        const result: Record<string, unknown> = {
          active: true,
          path: file.path,
          name: file.basename,
          extension: file.extension,
          modified: new Date(file.stat.mtime).toISOString(),
          created: new Date(file.stat.ctime).toISOString(),
          frontmatter: cache?.frontmatter || {},
          tags: cache?.tags?.map((t) => t.tag) || [],
          headings: cache?.headings?.map((h) => ({ level: h.level, text: h.heading })) || [],
          links: cache?.links?.map((l) => l.link) || [],
        };

        if (includeContent) {
          const content = await this.app.vault.cachedRead(file);
          result.content = content.slice(0, maxLength);
          result.truncated = content.length > maxLength;
          result.totalLength = content.length;
        }

        return JSON.stringify(result);
      },
    };
  }

  /**
   * Get graph neighbors (directly connected notes)
   */
  private getGraphNeighborsTool(): ToolDefinition {
    return {
      name: 'graph_neighbors',
      description:
        'Get notes that are directly connected to a given note (both inbound and outbound links). Useful for exploring the knowledge graph.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the note',
          },
          depth: {
            type: 'number',
            description: 'Depth of connections to explore (default: 1, max: 2)',
          },
        },
        required: ['path'],
      },
      handler: async (params) => {
        const filepath = params.path as string;
        const depth = Math.min((params.depth as number) || 1, 2);

        const file = this.app.vault.getAbstractFileByPath(filepath);
        if (!file) {
          return JSON.stringify({ error: `File not found: ${filepath}` });
        }

        const resolvedLinks = this.app.metadataCache.resolvedLinks;
        const visited = new Set<string>();
        const neighbors: Array<{
          path: string;
          title: string;
          direction: 'outgoing' | 'incoming';
          depth: number;
        }> = [];

        const explore = (currentPath: string, currentDepth: number) => {
          if (currentDepth > depth || visited.has(currentPath)) return;
          visited.add(currentPath);

          // Outgoing links
          const outgoing = resolvedLinks[currentPath] || {};
          for (const targetPath of Object.keys(outgoing)) {
            if (!visited.has(targetPath)) {
              const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
              if (targetFile && 'basename' in targetFile) {
                const cache = this.app.metadataCache.getFileCache(targetFile as TFile);
                neighbors.push({
                  path: targetPath,
                  title: (cache?.frontmatter?.title as string) || (targetFile as TFile).basename,
                  direction: 'outgoing',
                  depth: currentDepth,
                });
                if (currentDepth < depth) {
                  explore(targetPath, currentDepth + 1);
                }
              }
            }
          }

          // Incoming links
          for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
            if (links[currentPath] && !visited.has(sourcePath)) {
              const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
              if (sourceFile && 'basename' in sourceFile) {
                const cache = this.app.metadataCache.getFileCache(sourceFile as TFile);
                neighbors.push({
                  path: sourcePath,
                  title: (cache?.frontmatter?.title as string) || (sourceFile as TFile).basename,
                  direction: 'incoming',
                  depth: currentDepth,
                });
                if (currentDepth < depth) {
                  explore(sourcePath, currentDepth + 1);
                }
              }
            }
          }
        };

        explore(filepath, 1);

        return JSON.stringify({
          centerNote: filepath,
          depth,
          neighborCount: neighbors.length,
          neighbors,
        });
      },
    };
  }

  /**
   * Rename/move a note
   */
  private getRenameNoteTool(): ToolDefinition {
    return {
      name: 'rename_note',
      description:
        'Rename or move a note to a new path. Updates all links to the note automatically.',
      parameters: {
        type: 'object',
        properties: {
          oldPath: {
            type: 'string',
            description: 'Current path of the note',
          },
          newPath: {
            type: 'string',
            description: 'New path for the note',
          },
        },
        required: ['oldPath', 'newPath'],
      },
      handler: async (params) => {
        const oldPath = params.oldPath as string;
        const newPath = params.newPath as string;

        const file = this.app.vault.getAbstractFileByPath(oldPath);
        if (!file) {
          return JSON.stringify({ error: `File not found: ${oldPath}` });
        }

        // Check if destination exists
        if (this.app.vault.getAbstractFileByPath(newPath)) {
          return JSON.stringify({ error: `Destination already exists: ${newPath}` });
        }

        try {
          // Ensure parent folder exists
          const parentPath = newPath.split('/').slice(0, -1).join('/');
          if (parentPath && !this.app.vault.getAbstractFileByPath(parentPath)) {
            await this.app.vault.createFolder(parentPath);
          }

          await this.app.fileManager.renameFile(file, newPath);
          return JSON.stringify({
            success: true,
            oldPath,
            newPath,
            message: 'File renamed and links updated',
          });
        } catch (error) {
          return JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    };
  }

  /**
   * Execute a tool by name
   */
  async executeTool(
    name: string,
    params: Record<string, unknown>
  ): Promise<string> {
    const tool = this.getToolDefinitions().find((t) => t.name === name);
    if (!tool) {
      return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
    return tool.handler(params);
  }

  /**
   * Get tool schemas in a format suitable for MCP or Claude
   */
  getToolSchemas(): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> {
    return this.getToolDefinitions().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }
}
