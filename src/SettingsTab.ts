import { App, PluginSettingTab, Setting, Notice, Modal, TextComponent, TextAreaComponent } from 'obsidian';
import type ObsidiClaudePlugin from '../main';
import type { EmbeddingProviderType, ExternalMCPServer } from './types';

type SettingsTabId = 'agent' | 'embedding' | 'mcp' | 'tools';

export class SettingsTab extends PluginSettingTab {
  plugin: ObsidiClaudePlugin;
  private activeTab: SettingsTabId = 'agent';

  constructor(app: App, plugin: ObsidiClaudePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('obsidi-claude-settings');

    // Header
    containerEl.createEl('h2', { text: 'Obsidi-Claude Settings' });

    // Tab bar
    const tabBar = containerEl.createDiv('settings-tab-bar');
    const tabs: { id: SettingsTabId; label: string }[] = [
      { id: 'agent', label: 'Agent' },
      { id: 'embedding', label: 'Embedding' },
      { id: 'mcp', label: 'MCP Servers' },
      { id: 'tools', label: 'Tools' },
    ];

    for (const tab of tabs) {
      const tabEl = tabBar.createEl('button', {
        text: tab.label,
        cls: `settings-tab ${this.activeTab === tab.id ? 'is-active' : ''}`,
      });
      tabEl.onclick = () => {
        this.activeTab = tab.id;
        this.display();
      };
    }

    // Tab content
    const contentEl = containerEl.createDiv('settings-tab-content');

    switch (this.activeTab) {
      case 'agent':
        this.addAgentSettings(contentEl);
        break;
      case 'embedding':
        this.addEmbeddingSettings(contentEl);
        break;
      case 'mcp':
        this.addMCPSettings(contentEl);
        this.addExternalMCPSettings(contentEl);
        break;
      case 'tools':
        this.addToolSettings(contentEl);
        break;
    }

    // Reset always visible at bottom
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
          .addOption('transformers', 'Transformers.js (In-Browser, Free)')
          .addOption('ollama', 'Ollama (Local Server, Free)')
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
        .setDesc('Transformers.js model (loaded from HuggingFace CDN)')
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

      containerEl.createEl('p', {
        text: '⚡ Runs entirely in your browser. First load downloads the model (~22-110MB).',
        cls: 'setting-item-description',
      });
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

    new Setting(containerEl)
      .setName('Transport')
      .setDesc('How clients connect to the MCP server')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('http', 'HTTP (Recommended)')
          .addOption('stdio', 'Stdio (For CLI integration)')
          .addOption('both', 'Both (HTTP + Stdio)')
          .setValue(mcp.transport)
          .onChange(async (value) => {
            this.plugin.settings.mcp.transport = value as typeof mcp.transport;
            await this.plugin.saveSettings();

            // Restart server if running
            if (mcp.enabled && this.plugin.mcpServer?.isServerRunning()) {
              await this.plugin.stopMCPServer();
              await this.plugin.startMCPServer();
              new Notice('MCP server restarted with new transport');
            }

            this.display();
          })
      );

    if (mcp.transport === 'http' || mcp.transport === 'both') {
      new Setting(containerEl)
        .setName('HTTP Port')
        .setDesc('Port for HTTP transport (default: 3000)')
        .addText((text) =>
          text
            .setPlaceholder('3000')
            .setValue(String(mcp.httpPort))
            .onChange(async (value) => {
              const port = parseInt(value, 10);
              if (!isNaN(port) && port >= 1024 && port <= 65535) {
                this.plugin.settings.mcp.httpPort = port;
                await this.plugin.saveSettings();
              }
            })
        );
    }

    // Show MCP configuration instructions based on transport
    const infoEl = containerEl.createDiv({ cls: 'setting-item-description' });
    infoEl.style.marginTop = '10px';

    if (mcp.transport === 'http' || mcp.transport === 'both') {
      infoEl.innerHTML = `
        <strong>HTTP Transport:</strong><br>
        Server running at <code>http://localhost:${mcp.httpPort}/mcp</code><br>
        Health check: <code>http://localhost:${mcp.httpPort}/health</code><br><br>
        <strong>Claude Code Configuration:</strong><br>
        Add to <code>~/.claude/claude_desktop_config.json</code>:<br>
        <pre style="background: var(--background-secondary); padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 0.85em;">{
  "mcpServers": {
    "${mcp.serverName}": {
      "url": "http://localhost:${mcp.httpPort}/mcp"
    }
  }
}</pre>
        <em>Note: The MCP server exposes 16 tools for vault interaction including semantic search, file operations, and knowledge graph navigation.</em>
      `;
    } else {
      infoEl.innerHTML = `
        <strong>Stdio Transport:</strong><br>
        Add to <code>~/.claude/claude_desktop_config.json</code>:<br>
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
  }

  private addExternalMCPSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'External MCP Servers' });

    const servers = this.plugin.settings.externalMcpServers;

    // Add server button
    new Setting(containerEl)
      .setName('Add MCP Server')
      .setDesc('Connect additional MCP servers (mouse, media, etc.)')
      .addButton((button) =>
        button.setButtonText('Add Server').onClick(() => {
          new AddMCPServerModal(this.app, async (server) => {
            this.plugin.settings.externalMcpServers.push(server);
            await this.plugin.saveSettings();
            this.display();
          }).open();
        })
      );

    // List existing servers
    if (servers.length > 0) {
      const serversContainer = containerEl.createDiv('mcp-servers-list');

      for (let i = 0; i < servers.length; i++) {
        const server = servers[i];
        const serverEl = serversContainer.createDiv('mcp-server-item');
        serverEl.style.cssText = 'padding: 0.5rem; margin: 0.5rem 0; background: var(--background-secondary); border-radius: 4px;';

        // Build description with command and env count
        let desc = `${server.command} ${server.args.join(' ')}`;
        if (server.env && Object.keys(server.env).length > 0) {
          desc += ` (${Object.keys(server.env).length} env vars)`;
        }

        new Setting(serverEl)
          .setName(server.name)
          .setDesc(desc)
          .addToggle((toggle) =>
            toggle.setValue(server.enabled).onChange(async (value) => {
              this.plugin.settings.externalMcpServers[i].enabled = value;
              await this.plugin.saveSettings();
            })
          )
          .addButton((button) =>
            button.setIcon('check-circle').setTooltip('Test Connection').onClick(async () => {
              await this.testMCPServer(server);
            })
          )
          .addButton((button) =>
            button.setIcon('pencil').setTooltip('Edit').onClick(() => {
              new AddMCPServerModal(this.app, async (updated) => {
                this.plugin.settings.externalMcpServers[i] = updated;
                await this.plugin.saveSettings();
                this.display();
              }, server).open();
            })
          )
          .addButton((button) =>
            button.setIcon('trash').setTooltip('Remove').setWarning().onClick(async () => {
              this.plugin.settings.externalMcpServers.splice(i, 1);
              await this.plugin.saveSettings();
              this.display();
            })
          );
      }
    }
  }

  private async testMCPServer(server: ExternalMCPServer): Promise<void> {
    new Notice(`Testing ${server.name}...`);

    try {
      const { spawn } = await import('child_process');

      const proc = spawn(server.command, server.args, {
        env: { ...process.env, ...server.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Set a timeout for the test
      const timeout = setTimeout(() => {
        proc.kill();
      }, 5000);

      // Wait for the process to start and send an initialize request
      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      // Send MCP initialize request
      const initRequest = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'obsidi-claude-test', version: '1.0.0' },
        },
      });

      proc.stdin?.write(initRequest + '\n');

      // Wait for response
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));

      clearTimeout(timeout);
      proc.kill();

      // Check if we got a response
      if (stdout.includes('"result"') || stdout.includes('protocolVersion')) {
        new Notice(`${server.name}: Connected successfully!`, 3000);
      } else if (stderr) {
        new Notice(`${server.name}: Error - ${stderr.slice(0, 100)}`, 5000);
      } else {
        new Notice(`${server.name}: No response (server may need more time to start)`, 4000);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`${server.name}: Failed to start - ${msg}`, 5000);
    }
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

/**
 * Modal for adding/editing external MCP servers
 */
class AddMCPServerModal extends Modal {
  private onSubmit: (server: ExternalMCPServer) => Promise<void>;
  private existing: ExternalMCPServer | null;

  private nameInput: TextComponent;
  private commandInput: TextComponent;
  private argsInput: TextComponent;
  private envInput: TextAreaComponent;

  constructor(app: App, onSubmit: (server: ExternalMCPServer) => Promise<void>, existing?: ExternalMCPServer) {
    super(app);
    this.onSubmit = onSubmit;
    this.existing = existing || null;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: this.existing ? 'Edit MCP Server' : 'Add MCP Server' });

    // Name
    new Setting(contentEl)
      .setName('Server Name')
      .setDesc('Unique name for this MCP server (e.g., "mouse", "media")')
      .addText((text) => {
        this.nameInput = text;
        text
          .setPlaceholder('my-server')
          .setValue(this.existing?.name || '')
          .inputEl.style.width = '100%';
      });

    // Command
    new Setting(contentEl)
      .setName('Command')
      .setDesc('Executable to run (e.g., "node", "npx", "python")')
      .addText((text) => {
        this.commandInput = text;
        text
          .setPlaceholder('node')
          .setValue(this.existing?.command || 'node')
          .inputEl.style.width = '100%';
      });

    // Args
    new Setting(contentEl)
      .setName('Arguments')
      .setDesc('Command arguments, space-separated (e.g., "dist/index.js" or "tsx src/index.ts")')
      .addText((text) => {
        this.argsInput = text;
        text
          .setPlaceholder('/path/to/server/dist/index.js')
          .setValue(this.existing?.args.join(' ') || '')
          .inputEl.style.width = '100%';
      });

    // Environment variables
    new Setting(contentEl)
      .setName('Environment Variables')
      .setDesc('One per line: KEY=value')
      .addTextArea((text) => {
        this.envInput = text;
        const envStr = this.existing?.env
          ? Object.entries(this.existing.env).map(([k, v]) => `${k}=${v}`).join('\n')
          : '';
        text
          .setPlaceholder('API_KEY=your-key\nDEBUG=true')
          .setValue(envStr);
        text.inputEl.rows = 3;
        text.inputEl.style.width = '100%';
      });

    // Buttons
    const buttonContainer = contentEl.createDiv();
    buttonContainer.style.cssText = 'display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem;';

    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => this.close();

    const saveBtn = buttonContainer.createEl('button', { text: this.existing ? 'Save' : 'Add', cls: 'mod-cta' });
    saveBtn.onclick = async () => {
      const name = this.nameInput.getValue().trim();
      const command = this.commandInput.getValue().trim();
      const argsStr = this.argsInput.getValue().trim();
      const envStr = this.envInput.getValue().trim();

      if (!name) {
        new Notice('Server name is required');
        return;
      }
      if (!command) {
        new Notice('Command is required');
        return;
      }

      // Parse environment variables
      const env: Record<string, string> = {};
      if (envStr) {
        for (const line of envStr.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.substring(0, eqIdx).trim();
            const value = trimmed.substring(eqIdx + 1).trim();
            if (key) env[key] = value;
          }
        }
      }

      const server: ExternalMCPServer = {
        name,
        command,
        args: argsStr ? argsStr.split(/\s+/) : [],
        env: Object.keys(env).length > 0 ? env : undefined,
        enabled: this.existing?.enabled ?? true,
      };

      await this.onSubmit(server);
      this.close();
    };
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
