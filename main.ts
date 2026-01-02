import { Plugin, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import { ChatView, CHAT_VIEW_TYPE } from './src/ChatView';
import { SettingsTab } from './src/SettingsTab';
import { DEFAULT_SETTINGS, type ObsidiClaudeSettings } from './src/types';
import { RAGService } from './src/RAGService';
import { ObsidianTools } from './src/ObsidianTools';
import { StorageService } from './src/StorageService';
import { MCPServer } from './src/MCPServer';
import { BackendFactory } from './src/backends';
import { SkillRegistry } from './src/skills';
import { createLogger } from './src/Logger';

const log = createLogger('Plugin');

export default class ObsidiClaudePlugin extends Plugin {
  settings: ObsidiClaudeSettings;
  ragService: RAGService | null = null;
  obsidianTools: ObsidianTools | null = null;
  storage: StorageService;
  mcpServer: MCPServer | null = null;
  backendFactory: BackendFactory;
  skillRegistry: SkillRegistry;

  async onload(): Promise<void> {
    console.log('Loading Obsidi-Claude plugin');

    // Initialize storage service
    this.storage = new StorageService(this.app);
    await this.storage.initialize();

    // Load settings
    this.settings = await this.storage.loadSettings();

    // Set default working directory to vault root
    if (!this.settings.workingDirectory) {
      const adapter = this.app.vault.adapter as unknown as { basePath?: string };
      if (adapter.basePath) {
        this.settings.workingDirectory = adapter.basePath;
        await this.saveSettings();
      } else {
        console.warn('Obsidi-Claude: Could not determine vault path. Set working directory in settings.');
      }
    }

    // Initialize RAG service
    await this.initializeRAGService();

    // Initialize Obsidian tools
    this.obsidianTools = new ObsidianTools(this.app, this.ragService || undefined);

    // Initialize backend factory
    this.backendFactory = new BackendFactory(this.settings, this.obsidianTools);
    log.info('Backend factory initialized', this.backendFactory.getBackendInfo());

    // Initialize skill registry
    this.skillRegistry = new SkillRegistry(this.app, this.settings.skills);
    await this.skillRegistry.initialize();
    log.info('Skill registry initialized', { skillCount: this.skillRegistry.getSkills().length });

    // Register the chat view
    this.registerView(
      CHAT_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new ChatView(leaf, this)
    );

    // Add ribbon icon
    this.addRibbonIcon('message-circle', 'Open Claude Chat', () => {
      this.activateChatView();
    });

    // Add command to open chat
    this.addCommand({
      id: 'open-chat',
      name: 'Open Claude Chat',
      callback: () => this.activateChatView(),
    });

    // Add command for quick message
    this.addCommand({
      id: 'quick-chat',
      name: 'Quick Chat with Claude',
      callback: () => {
        this.activateChatView();
        // Focus the input after a short delay to let the view render
        setTimeout(() => {
          const input = document.querySelector(
            '.chat-input'
          ) as HTMLTextAreaElement;
          if (input) {
            input.focus();
          }
        }, 100);
      },
    });

    // Add command to rebuild index
    this.addCommand({
      id: 'rebuild-index',
      name: 'Rebuild Semantic Search Index',
      callback: async () => {
        if (!this.ragService?.isConfigured()) {
          new Notice('Semantic search is not configured. Enable it in settings.');
          return;
        }
        new Notice('Rebuilding index... This may take a while.');
        try {
          await this.ragService.indexVault(true);
          const stats = this.ragService.getStats();
          new Notice(
            `Index rebuilt: ${stats.totalFiles} files, ${stats.totalChunks} chunks`
          );
        } catch (error) {
          new Notice(`Index failed: ${error}`);
        }
      },
    });

    // Add command to reload skills
    this.addCommand({
      id: 'reload-skills',
      name: 'Reload Skills',
      callback: async () => {
        if (!this.settings.skills.enabled) {
          new Notice('Skills are disabled. Enable them in settings.');
          return;
        }
        try {
          await this.skillRegistry.reload();
          const skills = this.skillRegistry.getSkills();
          new Notice(`Loaded ${skills.length} skill${skills.length !== 1 ? 's' : ''}`);
        } catch (error) {
          new Notice(`Failed to reload skills: ${error}`);
        }
      },
    });

    // Add settings tab
    this.addSettingTab(new SettingsTab(this.app, this));

    // Register file events for auto-indexing
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.handleFileChange(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.handleFileChange(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.handleFileDelete(file.path);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.handleFileRename(file, oldPath);
        }
      })
    );

    // Auto-open on workspace ready if configured
    this.app.workspace.onLayoutReady(async () => {
      // Initial indexing if configured (skip transformers.js to avoid blocking UI)
      if (this.settings.embedding.enabled && this.settings.embedding.autoIndex) {
        // Skip auto-index for transformers.js - it blocks the main thread
        // User can manually trigger via "Rebuild Index" command
        if (this.settings.embedding.provider === 'transformers') {
          log.info('Skipping auto-index for transformers.js (use Rebuild Index command)');
        } else if (this.ragService?.isConfigured()) {
          // Run in background without blocking
          this.ragService.indexVault(false).catch((error) => {
            log.error('Initial indexing failed', error);
          });
        }
      }

      // Start MCP server if enabled
      if (this.settings.mcp.enabled) {
        await this.startMCPServer();
      }
    });
  }

  private async initializeRAGService(): Promise<void> {
    const storagePath = this.storage.getVectorsPath();

    this.ragService = new RAGService(
      this.app,
      this.settings.embedding,
      storagePath
    );

    try {
      await this.ragService.initialize();
    } catch (error) {
      console.error('Failed to initialize RAG service:', error);
    }
  }

  private handleFileChange(file: TFile): void {
    if (
      !this.settings.embedding.enabled ||
      !this.settings.embedding.autoIndex ||
      !this.ragService?.isConfigured() ||
      // Skip auto-indexing for transformers.js to avoid blocking UI
      this.settings.embedding.provider === 'transformers'
    ) {
      return;
    }

    // Debounce file changes
    this.ragService.indexSingleFile(file).catch((error) => {
      console.error(`Failed to index ${file.path}:`, error);
    });
  }

  private handleFileDelete(filepath: string): void {
    if (!this.ragService) return;
    this.ragService.removeFile(filepath).catch((error) => {
      console.error(`Failed to remove ${filepath} from index:`, error);
    });
  }

  private handleFileRename(file: TFile, oldPath: string): void {
    if (!this.ragService) return;

    // Remove old path, index new path
    this.ragService.removeFile(oldPath).catch(console.error);

    if (
      this.settings.embedding.enabled &&
      this.settings.embedding.autoIndex &&
      this.settings.embedding.provider !== 'transformers'
    ) {
      this.ragService.indexSingleFile(file).catch(console.error);
    }
  }

  async activateChatView(): Promise<void> {
    const { workspace } = this.app;

    // Check if view already exists
    const leaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (leaves.length > 0) {
      workspace.revealLeaf(leaves[0]);
      return;
    }

    // Create new view in right sidebar
    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: CHAT_VIEW_TYPE,
        active: true,
      });
      workspace.revealLeaf(leaf);
    }
  }

  async saveSettings(): Promise<void> {
    await this.storage.saveSettings(this.settings);

    // Update RAG service with new settings
    if (this.ragService) {
      this.ragService.updateSettings(this.settings.embedding);
    }

    // Update backend factory with new settings
    if (this.backendFactory) {
      this.backendFactory.updateSettings(this.settings);
    }

    // Update skill registry with new settings
    if (this.skillRegistry) {
      await this.skillRegistry.updateSettings(this.settings.skills);
    }
  }

  async startMCPServer(): Promise<void> {
    if (!this.obsidianTools) {
      log.warn('Cannot start MCP server: ObsidianTools not initialized');
      return;
    }

    if (this.mcpServer?.isServerRunning()) {
      log.debug('MCP server already running');
      return;
    }

    try {
      this.mcpServer = new MCPServer(this.obsidianTools, {
        name: this.settings.mcp.serverName,
        version: this.manifest.version,
        transport: this.settings.mcp.transport,
        httpPort: this.settings.mcp.httpPort,
      });
      await this.mcpServer.start();
      log.info('MCP server started', {
        name: this.settings.mcp.serverName,
        transport: this.settings.mcp.transport,
        httpPort: this.settings.mcp.httpPort,
      });
    } catch (error) {
      log.error('Failed to start MCP server', error);
      new Notice(`Failed to start MCP server: ${error}`);
    }
  }

  async stopMCPServer(): Promise<void> {
    if (!this.mcpServer) return;

    try {
      await this.mcpServer.stop();
      this.mcpServer = null;
      log.info('MCP server stopped');
    } catch (error) {
      log.error('Failed to stop MCP server', error);
    }
  }

  async onunload(): Promise<void> {
    log.info('Unloading Obsidi-Claude plugin');

    // Stop MCP server if running
    await this.stopMCPServer();

    // Dispose backend factory
    if (this.backendFactory) {
      await this.backendFactory.dispose();
    }
  }
}
