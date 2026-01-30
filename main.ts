import { Plugin, WorkspaceLeaf, TFile, Notice, Editor, MarkdownView, Menu } from 'obsidian';
import { ChatView, CHAT_VIEW_TYPE } from './src/chatView';
import { SettingsTab } from './src/settingsTab';
import { DEFAULT_SETTINGS, type ObsidiClaudeSettings } from './src/types';
import { RAGService } from './src/ragService';
import { ObsidianTools } from './src/obsidianTools';
import { StorageService } from './src/storageService';
import { MCPServer } from './src/mcpServer';
import { BackendFactory } from './src/backends';
import { SkillRegistry } from './src/skills';
import { createLogger } from './src/logger';

const log = createLogger('Plugin');

export default class ObsidiClaudePlugin extends Plugin {
  settings: ObsidiClaudeSettings;
  ragService: RAGService | null = null;
  obsidianTools: ObsidianTools | null = null;
  storage: StorageService;
  mcpServer: MCPServer | null = null;
  backendFactory: BackendFactory;
  skillRegistry: SkillRegistry;
  statusBarItem: HTMLElement | null = null;

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

    // Add status bar item
    this.setupStatusBar();

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

    // Add commands to control MCP server
    this.addCommand({
      id: 'toggle-mcp-server',
      name: 'Toggle MCP Server',
      callback: async () => {
        if (this.mcpServer?.isServerRunning()) {
          await this.stopMCPServer();
          new Notice('MCP server stopped');
        } else {
          await this.startMCPServer();
          new Notice('MCP server started');
        }
      },
    });

    this.addCommand({
      id: 'start-mcp-server',
      name: 'Start MCP Server',
      callback: async () => {
        if (this.mcpServer?.isServerRunning()) {
          new Notice('MCP server is already running');
          return;
        }
        await this.startMCPServer();
        new Notice('MCP server started');
      },
    });

    this.addCommand({
      id: 'stop-mcp-server',
      name: 'Stop MCP Server',
      callback: async () => {
        if (!this.mcpServer?.isServerRunning()) {
          new Notice('MCP server is not running');
          return;
        }
        await this.stopMCPServer();
        new Notice('MCP server stopped');
      },
    });

    // Add selection-based commands
    this.addCommand({
      id: 'ask-about-selection',
      name: 'Ask Claude about selection',
      editorCallback: (editor: Editor) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice('No text selected');
          return;
        }
        this.sendToClaude(`Please explain or answer questions about the following:\n\n${selection}`);
      },
    });

    this.addCommand({
      id: 'summarize-selection',
      name: 'Summarize selection',
      editorCallback: (editor: Editor) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice('No text selected');
          return;
        }
        this.sendToClaude(`Please provide a concise summary of the following:\n\n${selection}`);
      },
    });

    this.addCommand({
      id: 'improve-writing',
      name: 'Improve writing',
      editorCallback: (editor: Editor) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice('No text selected');
          return;
        }
        this.sendToClaude(`Please improve the writing quality of the following text while preserving its meaning. Suggest the improved version:\n\n${selection}`);
      },
    });

    this.addCommand({
      id: 'fix-grammar',
      name: 'Fix grammar and spelling',
      editorCallback: (editor: Editor) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice('No text selected');
          return;
        }
        this.sendToClaude(`Please fix any grammar and spelling errors in the following text:\n\n${selection}`);
      },
    });

    this.addCommand({
      id: 'explain-code',
      name: 'Explain code',
      editorCallback: (editor: Editor) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice('No text selected');
          return;
        }
        this.sendToClaude(`Please explain what this code does:\n\n\`\`\`\n${selection}\n\`\`\``);
      },
    });

    this.addCommand({
      id: 'summarize-note',
      name: 'Summarize current note',
      editorCallback: (editor: Editor) => {
        const content = editor.getValue();
        if (!content) {
          new Notice('Note is empty');
          return;
        }
        const activeFile = this.app.workspace.getActiveFile();
        const title = activeFile?.basename || 'this note';
        this.sendToClaude(`Please summarize "${title}":\n\n${content.slice(0, 10000)}${content.length > 10000 ? '\n\n[Content truncated...]' : ''}`);
      },
    });

    this.addCommand({
      id: 'generate-from-selection',
      name: 'Generate content from selection',
      editorCallback: (editor: Editor) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice('No text selected');
          return;
        }
        this.sendToClaude(`Based on the following outline/notes, please generate expanded content:\n\n${selection}`);
      },
    });

    // Chat view commands
    this.addCommand({
      id: 'focus-chat-input',
      name: 'Focus chat input',
      callback: () => {
        const chatView = this.getChatView();
        chatView?.focusInput();
      },
    });

    this.addCommand({
      id: 'new-conversation',
      name: 'New conversation',
      callback: () => {
        const chatView = this.getChatView();
        chatView?.newConversation();
      },
    });

    this.addCommand({
      id: 'clear-conversation',
      name: 'Clear conversation messages',
      callback: () => {
        const chatView = this.getChatView();
        chatView?.clearMessages();
      },
    });

    this.addCommand({
      id: 'abort-response',
      name: 'Abort/stop current response',
      callback: () => {
        const chatView = this.getChatView();
        chatView?.stopResponse();
      },
    });

    this.addCommand({
      id: 'copy-last-response',
      name: 'Copy last assistant response',
      callback: () => {
        const chatView = this.getChatView();
        chatView?.copyLastResponse();
      },
    });

    this.addCommand({
      id: 'toggle-conversation-history',
      name: 'Toggle conversation history panel',
      callback: () => {
        const chatView = this.getChatView();
        chatView?.toggleHistory();
      },
    });

    this.addCommand({
      id: 'toggle-chat-search',
      name: 'Search in conversation',
      callback: () => {
        const chatView = this.getChatView();
        chatView?.toggleSearch();
      },
    });

    // Register editor context menu
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, view: MarkdownView) => {
        const selection = editor.getSelection();
        if (selection) {
          menu.addSeparator();

          menu.addItem((item) => {
            item
              .setTitle('Ask Claude about this')
              .setIcon('message-circle')
              .onClick(() => {
                this.sendToClaude(`Please explain or answer questions about the following:\n\n${selection}`);
              });
          });

          menu.addItem((item) => {
            item
              .setTitle('Summarize')
              .setIcon('file-text')
              .onClick(() => {
                this.sendToClaude(`Please provide a concise summary of the following:\n\n${selection}`);
              });
          });

          menu.addItem((item) => {
            item
              .setTitle('Improve writing')
              .setIcon('pencil')
              .onClick(() => {
                this.sendToClaude(`Please improve the writing quality of the following text while preserving its meaning:\n\n${selection}`);
              });
          });

          menu.addItem((item) => {
            item
              .setTitle('Fix grammar')
              .setIcon('check-circle')
              .onClick(() => {
                this.sendToClaude(`Please fix any grammar and spelling errors in the following text:\n\n${selection}`);
              });
          });
        }
      })
    );

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

  /**
   * Send a message to Claude, opening the chat view if needed.
   */
  private async sendToClaude(message: string): Promise<void> {
    await this.activateChatView();

    // Get the chat view and send the message
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (leaves.length > 0) {
      const chatView = leaves[0].view as ChatView;
      // Use a small delay to ensure the view is ready
      setTimeout(() => {
        chatView.sendMessage(message);
      }, 100);
    }
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

  /**
   * Get the chat view if it exists.
   */
  getChatView(): ChatView | null {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (leaves.length > 0) {
      return leaves[0].view as ChatView;
    }
    return null;
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

  /**
   * Setup status bar indicator for Claude.
   */
  private setupStatusBar(): void {
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.addClass('obsidi-claude-status-bar');
    this.statusBarItem.setAttribute('aria-label', 'Claude Chat');
    this.updateStatusBar('idle');

    // Left click: Open chat
    this.statusBarItem.addEventListener('click', () => {
      this.activateChatView();
    });

    // Right click: Context menu
    this.statusBarItem.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showStatusBarMenu(e);
    });
  }

  /**
   * Update status bar indicator state.
   */
  updateStatusBar(state: 'idle' | 'processing' | 'error' | 'connected'): void {
    if (!this.statusBarItem) return;

    const icons: Record<string, string> = {
      idle: '⚪',
      processing: '🟡',
      error: '🔴',
      connected: '🟢',
    };

    const labels: Record<string, string> = {
      idle: 'Claude (idle)',
      processing: 'Claude (thinking...)',
      error: 'Claude (error)',
      connected: 'Claude (ready)',
    };

    this.statusBarItem.setText(`${icons[state]} Claude`);
    this.statusBarItem.setAttribute('aria-label', labels[state]);
  }

  /**
   * Show context menu for status bar item.
   */
  private showStatusBarMenu(e: MouseEvent): void {
    const menu = new Menu();

    menu.addItem((item) => {
      item
        .setTitle('Open Chat')
        .setIcon('message-circle')
        .onClick(() => this.activateChatView());
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle('New Conversation')
        .setIcon('plus')
        .onClick(() => {
          const chatView = this.getChatView();
          chatView?.newConversation();
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Clear Messages')
        .setIcon('trash-2')
        .onClick(() => {
          const chatView = this.getChatView();
          chatView?.clearMessages();
        });
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle('Settings')
        .setIcon('settings')
        .onClick(() => {
          // Open plugin settings
          (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } })
            .setting.open();
          (this.app as unknown as { setting: { openTabById(id: string): void } })
            .setting.openTabById(this.manifest.id);
        });
    });

    menu.showAtMouseEvent(e);
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
        // Enable session persistence for hot reload recovery
        sessionPersistence: {
          loadStaleSessionIds: () => this.storage.loadStaleSessionIds(),
          saveSessionIds: (ids) => this.storage.saveSessionIds(ids),
          clearSessionIds: () => this.storage.clearSessionIds(),
        },
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
