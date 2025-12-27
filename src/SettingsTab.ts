import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type ObsidiClaudePlugin from '../main';
import type { EmbeddingProviderType } from './types';

export class SettingsTab extends PluginSettingTab {
  plugin: ObsidiClaudePlugin;

  constructor(app: App, plugin: ObsidiClaudePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Obsidi-Claude Settings' });

    this.addAgentSettings(containerEl);
    this.addEmbeddingSettings(containerEl);
    this.addMCPSettings(containerEl);
    this.addToolSettings(containerEl);
    this.addResetSettings(containerEl);
  }

  private addAgentSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Agent Configuration' });

    // Model selection
    new Setting(containerEl)
      .setName('Model')
      .setDesc('Claude model to use for conversations')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('claude-sonnet-4-5', 'Claude Sonnet 4.5 (Recommended)')
          .addOption('claude-opus-4', 'Claude Opus 4')
          .addOption('claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet')
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value as typeof this.plugin.settings.model;
            await this.plugin.saveSettings();
          })
      );

    // Working directory
    new Setting(containerEl)
      .setName('Working Directory')
      .setDesc(
        'Directory where the agent operates. Leave empty to use vault root.'
      )
      .addText((text) =>
        text
          .setPlaceholder('/path/to/directory')
          .setValue(this.plugin.settings.workingDirectory)
          .onChange(async (value) => {
            this.plugin.settings.workingDirectory = value;
            await this.plugin.saveSettings();
          })
      );

    // Claude Code path
    new Setting(containerEl)
      .setName('Claude Code Path')
      .setDesc(
        'Path to Claude Code CLI executable. Run "which claude" in terminal to find it.'
      )
      .addText((text) =>
        text
          .setPlaceholder('/opt/homebrew/bin/claude')
          .setValue(this.plugin.settings.claudeCodePath)
          .onChange(async (value) => {
            this.plugin.settings.claudeCodePath = value;
            await this.plugin.saveSettings();
          })
      );

    // Permission mode
    new Setting(containerEl)
      .setName('Permission Mode')
      .setDesc('How to handle tool permissions')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('default', 'Default (Ask for confirmation)')
          .addOption('acceptEdits', 'Accept Edits (Auto-approve file changes)')
          .addOption('bypassPermissions', 'Bypass (No confirmation - use with caution)')
          .setValue(this.plugin.settings.permissionMode)
          .onChange(async (value) => {
            this.plugin.settings.permissionMode =
              value as typeof this.plugin.settings.permissionMode;
            await this.plugin.saveSettings();
            if (value === 'bypassPermissions') {
              new Notice(
                'Warning: Bypass mode skips all permission checks. Use with caution.',
                5000
              );
            }
          })
      );

    // Max turns
    new Setting(containerEl)
      .setName('Max Turns')
      .setDesc('Maximum number of conversation turns before stopping')
      .addSlider((slider) =>
        slider
          .setLimits(5, 100, 5)
          .setValue(this.plugin.settings.maxTurns)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxTurns = value;
            await this.plugin.saveSettings();
          })
      );

    // Show tool calls
    new Setting(containerEl)
      .setName('Show Tool Calls')
      .setDesc('Display when Claude uses tools (Read, Write, Bash, etc.)')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showToolCalls)
          .onChange(async (value) => {
            this.plugin.settings.showToolCalls = value;
            await this.plugin.saveSettings();
          })
      );

    // Stream responses
    new Setting(containerEl)
      .setName('Stream Responses')
      .setDesc('Show responses as they are generated')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.streamResponses)
          .onChange(async (value) => {
            this.plugin.settings.streamResponses = value;
            await this.plugin.saveSettings();
          })
      );

    // System prompt
    containerEl.createEl('h4', { text: 'System Prompt' });

    new Setting(containerEl)
      .setName('Custom Instructions')
      .setDesc('Instructions that guide Claude\'s behavior')
      .addTextArea((text) => {
        text
          .setPlaceholder('You are a helpful AI assistant...')
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 8;
        text.inputEl.cols = 50;
      });
  }

  private addEmbeddingSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Semantic Search (RAG)' });

    const embedding = this.plugin.settings.embedding;

    // Enable embeddings
    new Setting(containerEl)
      .setName('Enable Semantic Search')
      .setDesc(
        'Index vault for semantic search. Claude can find relevant notes by meaning, not just keywords.'
      )
      .addToggle((toggle) =>
        toggle.setValue(embedding.enabled).onChange(async (value) => {
          this.plugin.settings.embedding.enabled = value;
          await this.plugin.saveSettings();
          this.display(); // Refresh to show/hide provider settings
        })
      );

    if (!embedding.enabled) return;

    // Provider selection
    new Setting(containerEl)
      .setName('Embedding Provider')
      .setDesc('Choose local (free, offline) or remote (paid, higher quality)')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('transformers', 'Transformers.js (Local, Free)')
          .addOption('ollama', 'Ollama (Local, Free)')
          .addOption('openai', 'OpenAI (Remote, Paid)')
          .addOption('voyage', 'Voyage AI (Remote, Paid)')
          .setValue(embedding.provider)
          .onChange(async (value) => {
            this.plugin.settings.embedding.provider =
              value as EmbeddingProviderType;
            await this.plugin.saveSettings();
            this.display(); // Refresh to show provider-specific settings
          })
      );

    // Provider-specific settings
    if (embedding.provider === 'transformers') {
      new Setting(containerEl)
        .setName('Model')
        .setDesc('Transformers.js model (smaller = faster, larger = better quality)')
        .addDropdown((dropdown) =>
          dropdown
            .addOption('Xenova/all-MiniLM-L6-v2', 'MiniLM-L6-v2 (22MB, Fast)')
            .addOption('Xenova/bge-small-en-v1.5', 'BGE Small (33MB)')
            .addOption('Xenova/bge-base-en-v1.5', 'BGE Base (110MB, Better)')
            .setValue(embedding.localModel || 'Xenova/all-MiniLM-L6-v2')
            .onChange(async (value) => {
              this.plugin.settings.embedding.localModel = value;
              await this.plugin.saveSettings();
            })
        );
    } else if (embedding.provider === 'ollama') {
      new Setting(containerEl)
        .setName('Ollama Host')
        .setDesc('Ollama server URL (requires Ollama running)')
        .addText((text) =>
          text
            .setPlaceholder('http://localhost:11434')
            .setValue(embedding.ollamaHost || 'http://localhost:11434')
            .onChange(async (value) => {
              this.plugin.settings.embedding.ollamaHost = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Model')
        .setDesc('Ollama embedding model')
        .addDropdown((dropdown) =>
          dropdown
            .addOption('nomic-embed-text', 'nomic-embed-text (768 dims)')
            .addOption('mxbai-embed-large', 'mxbai-embed-large (1024 dims)')
            .addOption('all-minilm', 'all-minilm (384 dims, Fast)')
            .setValue(embedding.localModel || 'nomic-embed-text')
            .onChange(async (value) => {
              this.plugin.settings.embedding.localModel = value;
              await this.plugin.saveSettings();
            })
        );
    } else if (embedding.provider === 'openai') {
      new Setting(containerEl)
        .setName('OpenAI API Key')
        .setDesc('Your OpenAI API key')
        .addText((text) =>
          text
            .setPlaceholder('sk-...')
            .setValue(embedding.openaiApiKey || '')
            .onChange(async (value) => {
              this.plugin.settings.embedding.openaiApiKey = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Model')
        .setDesc('OpenAI embedding model')
        .addDropdown((dropdown) =>
          dropdown
            .addOption('text-embedding-3-small', 'text-embedding-3-small (Cost effective)')
            .addOption('text-embedding-3-large', 'text-embedding-3-large (Higher quality)')
            .setValue(embedding.openaiModel || 'text-embedding-3-small')
            .onChange(async (value) => {
              this.plugin.settings.embedding.openaiModel = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Dimensions')
        .setDesc('Embedding dimensions (lower = faster search, higher = better quality)')
        .addSlider((slider) =>
          slider
            .setLimits(256, 1536, 256)
            .setValue(embedding.openaiDimensions || 512)
            .setDynamicTooltip()
            .onChange(async (value) => {
              this.plugin.settings.embedding.openaiDimensions = value;
              await this.plugin.saveSettings();
            })
        );
    } else if (embedding.provider === 'voyage') {
      new Setting(containerEl)
        .setName('Voyage AI API Key')
        .setDesc('Your Voyage AI API key')
        .addText((text) =>
          text
            .setPlaceholder('pa-...')
            .setValue(embedding.voyageApiKey || '')
            .onChange(async (value) => {
              this.plugin.settings.embedding.voyageApiKey = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Model')
        .setDesc('Voyage AI embedding model')
        .addDropdown((dropdown) =>
          dropdown
            .addOption('voyage-3-large', 'voyage-3-large (Best quality)')
            .addOption('voyage-3', 'voyage-3 (Balanced)')
            .addOption('voyage-3-lite', 'voyage-3-lite (Fast)')
            .setValue(embedding.voyageModel || 'voyage-3-large')
            .onChange(async (value) => {
              this.plugin.settings.embedding.voyageModel = value;
              await this.plugin.saveSettings();
            })
        );
    }

    // Indexing settings
    containerEl.createEl('h4', { text: 'Indexing Options' });

    new Setting(containerEl)
      .setName('Auto-Index')
      .setDesc('Automatically index files when they change')
      .addToggle((toggle) =>
        toggle.setValue(embedding.autoIndex).onChange(async (value) => {
          this.plugin.settings.embedding.autoIndex = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Chunk Size')
      .setDesc('Characters per text chunk (smaller = more precise, larger = more context)')
      .addSlider((slider) =>
        slider
          .setLimits(256, 2048, 128)
          .setValue(embedding.chunkSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.embedding.chunkSize = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Chunk Overlap')
      .setDesc('Character overlap between chunks')
      .addSlider((slider) =>
        slider
          .setLimits(0, 200, 25)
          .setValue(embedding.chunkOverlap)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.embedding.chunkOverlap = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Excluded Folders')
      .setDesc('Folders to exclude from indexing (comma-separated)')
      .addText((text) =>
        text
          .setPlaceholder('.obsidian, .trash, templates')
          .setValue(embedding.excludeFolders.join(', '))
          .onChange(async (value) => {
            this.plugin.settings.embedding.excludeFolders = value
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            await this.plugin.saveSettings();
          })
      );

    // Index management buttons
    new Setting(containerEl)
      .setName('Index Actions')
      .setDesc('Manage the semantic search index')
      .addButton((button) =>
        button.setButtonText('Rebuild Index').onClick(async () => {
          if (this.plugin.ragService) {
            new Notice('Rebuilding index... This may take a while.');
            try {
              await this.plugin.ragService.indexVault(true);
              const stats = this.plugin.ragService.getStats();
              new Notice(
                `Index rebuilt: ${stats.totalFiles} files, ${stats.totalChunks} chunks`
              );
            } catch (error) {
              new Notice(`Index failed: ${error}`);
            }
          }
        })
      )
      .addButton((button) =>
        button
          .setButtonText('Clear Index')
          .setWarning()
          .onClick(async () => {
            if (this.plugin.ragService) {
              await this.plugin.ragService.clearIndex();
              new Notice('Index cleared');
            }
          })
      );

    // Show index stats
    if (this.plugin.ragService) {
      const stats = this.plugin.ragService.getStats();
      const statsEl = containerEl.createDiv({ cls: 'setting-item-description' });
      statsEl.style.marginTop = '10px';
      statsEl.innerHTML = `
        <strong>Index Status:</strong><br>
        Provider: ${stats.providerName || 'Not configured'}<br>
        Files indexed: ${stats.totalFiles}<br>
        Total chunks: ${stats.totalChunks}
      `;
    }
  }

  private addMCPSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'MCP Server' });

    const mcp = this.plugin.settings.mcp;

    new Setting(containerEl)
      .setName('Enable MCP Server')
      .setDesc(
        'Expose Obsidian vault tools via Model Context Protocol. Allows external Claude instances to interact with your vault.'
      )
      .addToggle((toggle) =>
        toggle.setValue(mcp.enabled).onChange(async (value) => {
          this.plugin.settings.mcp.enabled = value;
          await this.plugin.saveSettings();

          // Start or stop the MCP server
          if (value) {
            await this.plugin.startMCPServer();
            new Notice('MCP server enabled');
          } else {
            await this.plugin.stopMCPServer();
            new Notice('MCP server disabled');
          }

          this.display();
        })
      );

    if (!mcp.enabled) return;

    new Setting(containerEl)
      .setName('Server Name')
      .setDesc('Name used to identify this MCP server')
      .addText((text) =>
        text
          .setPlaceholder('obsidi-claude')
          .setValue(mcp.serverName)
          .onChange(async (value) => {
            this.plugin.settings.mcp.serverName = value || 'obsidi-claude';
            await this.plugin.saveSettings();
          })
      );

    // Show MCP configuration instructions
    const infoEl = containerEl.createDiv({ cls: 'setting-item-description' });
    infoEl.style.marginTop = '10px';
    infoEl.innerHTML = `
      <strong>Usage Instructions:</strong><br>
      Add this to your Claude Code MCP settings (<code>~/.claude/claude_desktop_config.json</code>):<br>
      <pre style="background: var(--background-secondary); padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 0.85em;">{
  "mcpServers": {
    "${mcp.serverName}": {
      "command": "obsidian",
      "args": ["--mcp-server"]
    }
  }
}</pre>
      <em>Note: The MCP server exposes 16 tools for vault interaction including semantic search, file operations, and knowledge graph navigation.</em>
    `;
  }

  private addToolSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Allowed Tools' });
    containerEl.createEl('p', {
      text: 'Select which tools Claude can use:',
      cls: 'setting-item-description',
    });

    const allTools = [
      { id: 'Read', desc: 'Read files' },
      { id: 'Write', desc: 'Create new files' },
      { id: 'Edit', desc: 'Modify existing files' },
      { id: 'Glob', desc: 'Search for files by pattern' },
      { id: 'Grep', desc: 'Search file contents' },
      { id: 'Bash', desc: 'Run shell commands' },
      { id: 'WebFetch', desc: 'Fetch web pages' },
      { id: 'WebSearch', desc: 'Search the web' },
    ];

    for (const tool of allTools) {
      new Setting(containerEl)
        .setName(tool.id)
        .setDesc(tool.desc)
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.allowedTools.includes(tool.id))
            .onChange(async (value) => {
              if (value) {
                if (!this.plugin.settings.allowedTools.includes(tool.id)) {
                  this.plugin.settings.allowedTools.push(tool.id);
                }
              } else {
                this.plugin.settings.allowedTools =
                  this.plugin.settings.allowedTools.filter((t) => t !== tool.id);
              }
              await this.plugin.saveSettings();
            })
        );
    }
  }

  private addResetSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Reset' });

    new Setting(containerEl)
      .setName('Reset to Defaults')
      .setDesc('Reset all settings to their default values')
      .addButton((button) =>
        button.setButtonText('Reset').setWarning().onClick(async () => {
          const { DEFAULT_SETTINGS } = await import('./types');
          this.plugin.settings = { ...DEFAULT_SETTINGS };
          await this.plugin.saveSettings();
          this.display();
          new Notice('Settings reset to defaults');
        })
      );
  }
}
