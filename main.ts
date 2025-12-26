import { Plugin, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import { ChatView, CHAT_VIEW_TYPE } from './src/ChatView';
import { SettingsTab } from './src/SettingsTab';
import { DEFAULT_SETTINGS, type ObsidiClaudeSettings } from './src/types';
import { RAGService } from './src/RAGService';
import { ObsidianTools } from './src/ObsidianTools';
import { StorageService } from './src/StorageService';

export default class ObsidiClaudePlugin extends Plugin {
  settings: ObsidiClaudeSettings;
  ragService: RAGService | null = null;
  obsidianTools: ObsidianTools | null = null;
  storage: StorageService;

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
      // Initial indexing if configured
      if (this.settings.embedding.enabled && this.settings.embedding.autoIndex) {
        if (this.ragService?.isConfigured()) {
          // Run in background without blocking
          this.ragService.indexVault(false).catch((error) => {
            console.error('Initial indexing failed:', error);
          });
        }
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
      !this.ragService?.isConfigured()
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

    if (this.settings.embedding.enabled && this.settings.embedding.autoIndex) {
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
  }

  onunload(): void {
    console.log('Unloading Obsidi-Claude plugin');
  }
}
