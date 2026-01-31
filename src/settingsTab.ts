import { App, PluginSettingTab, Setting, Notice, Modal, TextComponent, TextAreaComponent } from 'obsidian';
import type ObsidiClaudePlugin from '../main';
import type { EmbeddingProviderType, ExternalMCPServer } from './types';
import { createLogger } from './logger';

const log = createLogger('SettingsTab');

type SettingsTabId = 'agent' | 'embedding' | 'mcp' | 'tools' | 'about';

export class SettingsTab extends PluginSettingTab {
  plugin: ObsidiClaudePlugin;
  private activeTab: SettingsTabId = 'agent';
  /** Track which collapsible sections are expanded */
  private expandedSections: Set<string> = new Set(['display']); // display expanded by default

  constructor(app: App, plugin: ObsidiClaudePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Create a collapsible section with a clickable header
   */
  private createCollapsibleSection(
    containerEl: HTMLElement,
    id: string,
    title: string,
    defaultExpanded = false
  ): HTMLElement {
    const isExpanded = this.expandedSections.has(id) || defaultExpanded;

    const headerEl = containerEl.createDiv({ cls: 'settings-section-header' });
    headerEl.style.cssText = 'display: flex; align-items: center; cursor: pointer; padding: 0.5rem 0; margin-top: 1rem; border-bottom: 1px solid var(--background-modifier-border);';

    const chevron = headerEl.createSpan({ cls: 'settings-section-chevron' });
    chevron.style.cssText = 'margin-right: 0.5rem; transition: transform 0.15s ease;';
    chevron.innerHTML = isExpanded ? '▼' : '▶';

    headerEl.createEl('h4', { text: title }).style.cssText = 'margin: 0; flex: 1;';

    const contentEl = containerEl.createDiv({ cls: 'settings-section-content' });
    contentEl.style.display = isExpanded ? 'block' : 'none';

    headerEl.onclick = () => {
      const nowExpanded = !this.expandedSections.has(id);
      if (nowExpanded) {
        this.expandedSections.add(id);
      } else {
        this.expandedSections.delete(id);
      }
      chevron.innerHTML = nowExpanded ? '▼' : '▶';
      contentEl.style.display = nowExpanded ? 'block' : 'none';
    };

    return contentEl;
  }

  /**
   * Render the API key setting with secure storage.
   * Shows status and provides set/clear buttons without exposing the actual key.
   */
  private async renderApiKeySetting(setting: Setting): Promise<void> {
    const hasKey = await this.plugin.hasApiKey();
    const controlEl = setting.controlEl;

    // Clear any existing controls
    controlEl.empty();

    // Status indicator
    const statusEl = controlEl.createSpan({
      cls: `api-key-status ${hasKey ? 'configured' : 'not-configured'}`,
    });
    statusEl.setText(hasKey ? '✓ Configured' : '✗ Not configured');
    statusEl.style.marginRight = '1rem';
    statusEl.style.color = hasKey ? 'var(--text-success)' : 'var(--text-muted)';

    // Set/Update button
    const setBtn = controlEl.createEl('button', {
      text: hasKey ? 'Update' : 'Set Key',
      cls: 'mod-cta',
    });
    setBtn.style.marginRight = '0.5rem';
    setBtn.onclick = () => {
      new ApiKeyModal(this.app, async (key) => {
        await this.plugin.setApiKey(key);
        new Notice('API key saved securely');
        this.renderApiKeySetting(setting);
      }).open();
    };

    // Clear button (only if key exists)
    if (hasKey) {
      const clearBtn = controlEl.createEl('button', {
        text: 'Clear',
      });
      clearBtn.onclick = async () => {
        await this.plugin.clearApiKey();
        new Notice('API key cleared');
        this.renderApiKeySetting(setting);
      };
    }
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
      { id: 'about', label: 'About' },
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
      case 'about':
        this.addAboutSettings(contentEl);
        break;
    }

    // Reset always visible at bottom
    this.addResetSettings(containerEl);
  }

  private addAgentSettings(containerEl: HTMLElement): void {
    // ═══════════════════════════════════════════════════════════════════
    // ESSENTIAL - Always visible at top
    // ═══════════════════════════════════════════════════════════════════

    // Model selection
    new Setting(containerEl)
      .setName('Model')
      .setDesc('Claude model to use for conversations')
      .addDropdown((dropdown) => {
        this.populateModelDropdown(dropdown);
        dropdown
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value as typeof this.plugin.settings.model;
            await this.plugin.saveSettings();
          });
      });

    // Include active note
    new Setting(containerEl)
      .setName('Include Active Note')
      .setDesc('Automatically include the currently open note as context')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.activeNoteContext)
          .onChange(async (value) => {
            this.plugin.settings.activeNoteContext = value;
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

    // ═══════════════════════════════════════════════════════════════════
    // DISPLAY PREFERENCES - Collapsible, expanded by default
    // ═══════════════════════════════════════════════════════════════════
    const displaySection = this.createCollapsibleSection(containerEl, 'display', 'Display Preferences', true);

    new Setting(displaySection)
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

    new Setting(displaySection)
      .setName('Show Message Actions')
      .setDesc('Display action buttons (copy, bookmark, reactions) below messages')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showMessageActions)
          .onChange(async (value) => {
            this.plugin.settings.showMessageActions = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(displaySection)
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

    // ═══════════════════════════════════════════════════════════════════
    // SAFETY & LIMITS - Collapsible, collapsed by default
    // ═══════════════════════════════════════════════════════════════════
    const limitsSection = this.createCollapsibleSection(containerEl, 'limits', 'Safety & Limits');

    new Setting(limitsSection)
      .setName('Max Budget (USD)')
      .setDesc('Maximum spend per conversation (empty = no limit)')
      .addText((text) =>
        text
          .setPlaceholder('10.00')
          .setValue(this.plugin.settings.maxBudgetUsd?.toString() ?? '')
          .onChange(async (value) => {
            const trimmed = value.trim().replace(/^\$/, '');
            if (!trimmed) {
              this.plugin.settings.maxBudgetUsd = undefined;
            } else {
              const num = parseFloat(trimmed);
              if (!isNaN(num) && num > 0) {
                this.plugin.settings.maxBudgetUsd = num;
              }
            }
            await this.plugin.saveSettings();
          })
      );

    new Setting(limitsSection)
      .setName('Max Turns')
      .setDesc('Maximum conversation turns before stopping')
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

    // ═══════════════════════════════════════════════════════════════════
    // BACKEND SETUP - Collapsible, collapsed by default
    // ═══════════════════════════════════════════════════════════════════
    const backendSection = this.createCollapsibleSection(containerEl, 'backend', 'Backend Setup');

    new Setting(backendSection)
      .setName('Backend')
      .setDesc('Which backend to use for Claude interactions')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('auto', 'Auto (SDK on desktop, API on mobile)')
          .addOption('sdk', 'SDK (Claude Code CLI - desktop only)')
          .addOption('api', 'API (Direct Anthropic API)')
          .setValue(this.plugin.settings.preferredBackend)
          .onChange(async (value) => {
            this.plugin.settings.preferredBackend = value as 'auto' | 'sdk' | 'api';
            await this.plugin.saveSettings();
            this.display();
          })
      );

    // Show current backend info
    const backendInfo = this.plugin.backendFactory?.getBackendInfo();
    if (backendInfo) {
      const infoEl = backendSection.createDiv({ cls: 'setting-item-description' });
      infoEl.style.marginTop = '-0.5rem';
      infoEl.style.marginBottom = '0.5rem';
      infoEl.innerHTML = `<em>Current: ${backendInfo.current.toUpperCase()} backend (${backendInfo.sdkAvailable ? 'SDK available' : 'SDK unavailable'})</em>`;
    }

    // API Key with secure storage
    const apiKeySetting = new Setting(backendSection)
      .setName('Anthropic API Key')
      .setDesc('Required for API backend. Stored securely. Env var ANTHROPIC_API_KEY takes precedence.');

    // Add status indicator and buttons asynchronously
    this.renderApiKeySetting(apiKeySetting);

    new Setting(backendSection)
      .setName('Claude Code Path')
      .setDesc('Path to Claude Code CLI. Run "which claude" in terminal to find it.')
      .addText((text) =>
        text
          .setPlaceholder('/opt/homebrew/bin/claude')
          .setValue(this.plugin.settings.claudeCodePath)
          .onChange(async (value) => {
            this.plugin.settings.claudeCodePath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(backendSection)
      .setName('Working Directory')
      .setDesc('Directory where the agent operates. Leave empty for vault root.')
      .addText((text) =>
        text
          .setPlaceholder('/path/to/directory')
          .setValue(this.plugin.settings.workingDirectory)
          .onChange(async (value) => {
            this.plugin.settings.workingDirectory = value;
            await this.plugin.saveSettings();
          })
      );

    // ═══════════════════════════════════════════════════════════════════
    // ADVANCED - Collapsible, collapsed by default
    // ═══════════════════════════════════════════════════════════════════
    const advancedSection = this.createCollapsibleSection(containerEl, 'advanced', 'Advanced');

    // System prompt
    new Setting(advancedSection)
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
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;
      });

    // SDK-specific advanced settings (only if SDK available)
    const backendFactory = this.plugin.backendFactory;
    if (backendFactory?.getBackendInfo().sdkAvailable) {
      this.addSDKAdvancedSettings(advancedSection);
    }

    // Skills settings
    this.addSkillsSettings(advancedSection);
  }

  /**
   * Add skills-related settings to a container
   */
  private addSkillsSettings(containerEl: HTMLElement): void {
    const skillsHeader = containerEl.createEl('h5', { text: 'Skills' });
    skillsHeader.style.marginTop = '1rem';

    new Setting(containerEl)
      .setName('Enable Skills')
      .setDesc('Load SKILL.md files from your vault to enhance Claude\'s capabilities')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.skills.enabled)
          .onChange(async (value) => {
            this.plugin.settings.skills.enabled = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.skills.enabled) {
      new Setting(containerEl)
        .setName('Skills Folder')
        .setDesc('Vault folder containing SKILL.md files')
        .addText((text) =>
          text
            .setPlaceholder('.claude/skills')
            .setValue(this.plugin.settings.skills.folderPath)
            .onChange(async (value) => {
              this.plugin.settings.skills.folderPath = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Install Bundled Skills')
        .setDesc('Auto-install default skills like Obsidian Markdown (by kepano)')
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.skills.installBundledSkills)
            .onChange(async (value) => {
              this.plugin.settings.skills.installBundledSkills = value;
              await this.plugin.saveSettings();
              if (value) {
                await this.plugin.skillRegistry?.reload();
                this.display();
              }
            })
        );

      const skills = this.plugin.skillRegistry?.getSkills() ?? [];
      new Setting(containerEl)
        .setName('Loaded Skills')
        .setDesc(`${skills.length} skill${skills.length !== 1 ? 's' : ''} loaded`)
        .addButton((button) =>
          button.setButtonText('Reload Skills').onClick(async () => {
            try {
              await this.plugin.skillRegistry.reload();
              new Notice(`Loaded ${this.plugin.skillRegistry.getSkills().length} skills`);
              this.display();
            } catch (error) {
              new Notice(`Failed to reload skills: ${error}`);
            }
          })
        );

      if (skills.length > 0) {
        const skillsListEl = containerEl.createDiv({ cls: 'setting-item-description' });
        skillsListEl.style.marginTop = '0.5rem';
        skillsListEl.innerHTML = `<strong>Active skills:</strong> ${skills.map(s => s.name).join(', ')}`;
      }
    }
  }

  private addSDKAdvancedSettings(containerEl: HTMLElement): void {
    // SDK Options header (nested in Advanced section)
    const sdkHeader = containerEl.createEl('h5', { text: 'SDK Options' });
    sdkHeader.style.marginTop = '1rem';

    // System prompt mode
    new Setting(containerEl)
      .setName('System Prompt Mode')
      .setDesc('How to handle your custom system prompt')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('append', 'Append (Add to Claude Code defaults)')
          .addOption('replace', 'Replace (Use only your prompt)')
          .setValue(this.plugin.settings.systemPromptMode)
          .onChange(async (value) => {
            this.plugin.settings.systemPromptMode = value as 'replace' | 'append';
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Auto-Continue Session')
      .setDesc('Continue the most recent session in working directory')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.continueSession)
          .onChange(async (value) => {
            this.plugin.settings.continueSession = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('File Checkpointing')
      .setDesc('Enable undo/rewind for file changes (use /undo command)')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableFileCheckpointing)
          .onChange(async (value) => {
            this.plugin.settings.enableFileCheckpointing = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Extended Context (1M tokens)')
      .setDesc('Enable 1M token context window (Sonnet 4/4.5 only, beta)')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.extendedContext)
          .onChange(async (value) => {
            this.plugin.settings.extendedContext = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Load Vault CLAUDE.md')
      .setDesc('Load project instructions from .claude/CLAUDE.md')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.loadVaultClaudeMd)
          .onChange(async (value) => {
            this.plugin.settings.loadVaultClaudeMd = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Max Thinking Tokens')
      .setDesc('Limit thinking tokens to control costs (empty = no limit)')
      .addText((text) =>
        text
          .setPlaceholder('32000')
          .setValue(this.plugin.settings.maxThinkingTokens?.toString() ?? '')
          .onChange(async (value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              this.plugin.settings.maxThinkingTokens = undefined;
            } else {
              const num = parseInt(trimmed, 10);
              if (!isNaN(num) && num > 0) {
                this.plugin.settings.maxThinkingTokens = num;
              }
            }
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Additional Directories')
      .setDesc('Extra directories Claude can access (comma-separated)')
      .addText((text) =>
        text
          .setPlaceholder('/path/to/dir1, /path/to/dir2')
          .setValue(this.plugin.settings.additionalDirectories.join(', '))
          .onChange(async (value) => {
            this.plugin.settings.additionalDirectories = value
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Blocked Tools')
      .setDesc('Tools to disable (comma-separated, e.g., "Bash, WebSearch")')
      .addText((text) =>
        text
          .setPlaceholder('Bash, WebSearch')
          .setValue(this.plugin.settings.disallowedTools.join(', '))
          .onChange(async (value) => {
            this.plugin.settings.disallowedTools = value
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            await this.plugin.saveSettings();
          })
      );

    // Main agent (only show if agents are configured)
    const agents = this.plugin.settings.agents;
    const agentOptions: string[] = [''];
    if (agents.enabled) {
      if (agents.useBuiltinAgents) {
        agentOptions.push('research', 'writer', 'organizer');
      }
      for (const agent of agents.customAgents) {
        if (agent.enabled) {
          agentOptions.push(agent.name);
        }
      }
    }

    if (agentOptions.length > 1) {
      new Setting(containerEl)
        .setName('Main Agent')
        .setDesc('Use a specific agent for all conversations')
        .addDropdown((dropdown) => {
          for (const opt of agentOptions) {
            dropdown.addOption(opt, opt || '(None)');
          }
          dropdown
            .setValue(this.plugin.settings.mainAgent ?? '')
            .onChange(async (value) => {
              this.plugin.settings.mainAgent = value || undefined;
              await this.plugin.saveSettings();
            });
        });
    }

    new Setting(containerEl)
      .setName('Fallback Model')
      .setDesc('Model to use if primary is rate-limited')
      .addDropdown((dropdown) => {
        dropdown.addOption('', '(None)');
        this.populateModelDropdown(dropdown);
        dropdown
          .setValue(this.plugin.settings.fallbackModel ?? '')
          .onChange(async (value) => {
            this.plugin.settings.fallbackModel = value as typeof this.plugin.settings.fallbackModel || undefined;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Ephemeral Mode')
      .setDesc('Privacy mode - sessions not saved to disk')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.ephemeralMode).onChange(async (value) => {
          this.plugin.settings.ephemeralMode = value;
          await this.plugin.saveSettings();
        })
      );

    // Sandbox settings
    const sandboxHeader = containerEl.createEl('h5', { text: 'Sandbox' });
    sandboxHeader.style.marginTop = '1rem';

    new Setting(containerEl)
      .setName('Sandbox Mode')
      .setDesc('Run Bash commands in a sandboxed environment')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.sandboxEnabled).onChange(async (value) => {
          this.plugin.settings.sandboxEnabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Auto-allow Bash in Sandbox')
      .setDesc('Auto-approve Bash when sandbox is enabled')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoAllowBashIfSandboxed).onChange(async (value) => {
          this.plugin.settings.autoAllowBashIfSandboxed = value;
          await this.plugin.saveSettings();
        })
      );

    // Hooks settings
    const hooksHeader = containerEl.createEl('h5', { text: 'Hooks' });
    hooksHeader.style.marginTop = '1rem';

    new Setting(containerEl)
      .setName('Enable Hooks')
      .setDesc('SDK hooks for vault refresh, audit logging, etc.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.hooks.enabled).onChange(async (value) => {
          this.plugin.settings.hooks.enabled = value;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (this.plugin.settings.hooks.enabled) {
      new Setting(containerEl)
        .setName('Auto-refresh Vault')
        .setDesc('Refresh Obsidian after Claude edits files')
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.hooks.autoRefreshVault).onChange(async (value) => {
            this.plugin.settings.hooks.autoRefreshVault = value;
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName('Audit Tool Usage')
        .setDesc('Log all tool usage for debugging')
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.hooks.auditToolUsage).onChange(async (value) => {
            this.plugin.settings.hooks.auditToolUsage = value;
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName('Show SDK Notifications')
        .setDesc('Display SDK notifications (may be verbose)')
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.hooks.showNotifications).onChange(async (value) => {
            this.plugin.settings.hooks.showNotifications = value;
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName('Hook Blocked Tools')
        .setDesc('Tools to block via hooks (e.g., Bash,Write)')
        .addText((text) =>
          text
            .setPlaceholder('Tool1,Tool2')
            .setValue(this.plugin.settings.hooks.blockedTools.join(','))
            .onChange(async (value) => {
              this.plugin.settings.hooks.blockedTools = value
                .split(',')
                .map((t) => t.trim())
                .filter((t) => t.length > 0);
              await this.plugin.saveSettings();
            })
        );
    }

    // Compaction settings
    const compactionHeader = containerEl.createEl('h5', { text: 'Context Compaction' });
    compactionHeader.style.marginTop = '1rem';

    new Setting(containerEl)
      .setName('Compaction Instructions')
      .setDesc('Instructions to preserve info during compaction')
      .addTextArea((text) => {
        text
          .setPlaceholder('Preserve vault structure, important note names...')
          .setValue(this.plugin.settings.compactionInstructions || '')
          .onChange(async (value) => {
            this.plugin.settings.compactionInstructions = value || undefined;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
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

    // Provider-specific warnings and settings
    if (embedding.provider === 'transformers') {
      const warningEl = containerEl.createDiv({ cls: 'setting-warning' });
      warningEl.innerHTML = `
        <strong>⚠️  Performance Notice</strong>
        Transformers.js runs in your browser and may cause brief UI freezes during indexing.
        <ul>
          <li><strong>Recommended for:</strong> Small vaults (&lt;500 files)</li>
          <li><strong>For larger vaults:</strong> Use Ollama (free, local, no UI blocking)</li>
        </ul>
      `;

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
          .addOption('sse', 'SSE (Deprecated)')
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

    if (mcp.transport === 'http' || mcp.transport === 'sse' || mcp.transport === 'both') {
      new Setting(containerEl)
        .setName('HTTP Port')
        .setDesc('Port for HTTP/SSE transport (default: 3000)')
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
    } else if (mcp.transport === 'sse') {
      infoEl.innerHTML = `
        <strong>SSE Transport (Deprecated):</strong><br>
        SSE endpoint: <code>http://localhost:${mcp.httpPort}/sse</code><br>
        Messages endpoint: <code>http://localhost:${mcp.httpPort}/messages</code><br>
        Health check: <code>http://localhost:${mcp.httpPort}/health</code><br><br>
        <strong>Claude Code Configuration:</strong><br>
        Add to <code>~/.claude/claude_desktop_config.json</code>:<br>
        <pre style="background: var(--background-secondary); padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 0.85em;">{
  "mcpServers": {
    "${mcp.serverName}": {
      "url": "http://localhost:${mcp.httpPort}/sse"
    }
  }
}</pre>
        <em>Note: SSE transport is deprecated. Consider using HTTP transport instead.</em>
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
    log.info('Validating MCP server config', {
      name: server.name,
      command: server.command,
      args: server.args,
      env: server.env ? Object.keys(server.env) : [],
    });

    // Validate configuration
    const issues: string[] = [];

    if (!server.command.trim()) {
      issues.push('Command is empty');
    }

    if (!server.name.trim()) {
      issues.push('Name is empty');
    }

    // Check if command is an absolute path and exists
    if (server.command.startsWith('/') || server.command.match(/^[A-Z]:\\/i)) {
      try {
        const { existsSync } = require('fs') as typeof import('fs');
        if (!existsSync(server.command)) {
          issues.push(`Command not found: ${server.command}`);
        }
      } catch {
        // Can't check, assume OK
      }
    }

    if (issues.length > 0) {
      log.warn('MCP server config validation failed', { name: server.name, issues });
      new Notice(`${server.name}: ${issues.join(', ')}`, 5000);
      return;
    }

    // Configuration looks valid
    log.info('MCP server config validated', { name: server.name });
    new Notice(
      `${server.name}: Configuration valid. ` +
      `Server will be started by Claude Code when used in conversation.`,
      4000
    );
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

  private addAboutSettings(containerEl: HTMLElement): void {
    // Get version from manifest
    const manifest = this.plugin.manifest;

    // Hero section with logo/icon
    const heroEl = containerEl.createDiv({ cls: 'about-hero' });
    heroEl.style.cssText = 'text-align: center; padding: 1.5rem 0; border-bottom: 1px solid var(--background-modifier-border); margin-bottom: 1rem;';

    const titleEl = heroEl.createEl('h2', { text: 'Obsidi-Claude' });
    titleEl.style.cssText = 'margin: 0 0 0.5rem 0; font-size: 1.5rem;';

    const versionEl = heroEl.createDiv({ cls: 'about-version' });
    versionEl.style.cssText = 'font-size: 1.1rem; color: var(--text-muted); margin-bottom: 0.5rem;';
    versionEl.setText(`Version ${manifest.version}`);

    const descEl = heroEl.createDiv({ cls: 'about-description' });
    descEl.style.cssText = 'color: var(--text-muted); max-width: 400px; margin: 0 auto;';
    descEl.setText(manifest.description);

    // Links section
    containerEl.createEl('h3', { text: 'Links' });

    new Setting(containerEl)
      .setName('GitHub Repository')
      .setDesc('View source code, report issues, and contribute')
      .addButton((button) =>
        button.setButtonText('Open').onClick(() => {
          window.open('https://github.com/cameronsjo/obsidi-claude', '_blank');
        })
      );

    new Setting(containerEl)
      .setName('Documentation')
      .setDesc('Learn how to use Obsidi-Claude effectively')
      .addButton((button) =>
        button.setButtonText('View Docs').onClick(() => {
          window.open('https://github.com/cameronsjo/obsidi-claude#readme', '_blank');
        })
      );

    new Setting(containerEl)
      .setName('Report Issue')
      .setDesc('Found a bug? Let us know!')
      .addButton((button) =>
        button.setButtonText('Report').onClick(() => {
          window.open('https://github.com/cameronsjo/obsidi-claude/issues/new', '_blank');
        })
      );

    // System info section
    containerEl.createEl('h3', { text: 'System Information' });

    const infoEl = containerEl.createDiv({ cls: 'about-system-info' });
    infoEl.style.cssText = 'background: var(--background-secondary); padding: 1rem; border-radius: 6px; font-family: var(--font-monospace); font-size: 0.85rem;';

    const backendInfo = this.plugin.backendFactory?.getBackendInfo();
    const ragStats = this.plugin.ragService?.getStats();

    const infoLines = [
      `Plugin Version: ${manifest.version}`,
      `Min Obsidian: ${manifest.minAppVersion}`,
      `Current Backend: ${backendInfo?.current.toUpperCase() ?? 'Unknown'}`,
      `SDK Available: ${backendInfo?.sdkAvailable ? 'Yes' : 'No'}`,
      `Model: ${this.plugin.settings.model}`,
      `RAG Enabled: ${this.plugin.settings.embedding.enabled ? 'Yes' : 'No'}`,
      ragStats ? `Indexed Files: ${ragStats.totalFiles}` : null,
      ragStats ? `Index Chunks: ${ragStats.totalChunks}` : null,
      `MCP Server: ${this.plugin.settings.mcp.enabled ? 'Enabled' : 'Disabled'}`,
      `External MCP Servers: ${this.plugin.settings.externalMcpServers.filter(s => s.enabled).length}`,
    ].filter(Boolean);

    infoEl.innerHTML = infoLines.join('<br>');

    // Copy system info button
    new Setting(containerEl)
      .setName('Copy System Info')
      .setDesc('Copy system information for bug reports')
      .addButton((button) =>
        button.setButtonText('Copy').onClick(() => {
          const info = infoLines.join('\n');
          navigator.clipboard.writeText(info);
          new Notice('System info copied to clipboard');
        })
      );

    // Credits
    containerEl.createEl('h3', { text: 'Credits' });

    const creditsEl = containerEl.createDiv({ cls: 'about-credits' });
    creditsEl.style.cssText = 'color: var(--text-muted); line-height: 1.6;';
    creditsEl.innerHTML = `
      <p>Created by <a href="${manifest.authorUrl}" target="_blank">${manifest.author}</a></p>
      <p>Powered by <a href="https://www.anthropic.com/claude" target="_blank">Claude</a> and the <a href="https://github.com/anthropics/claude-code" target="_blank">Claude Agent SDK</a></p>
      <p style="margin-top: 1rem; font-size: 0.9rem;">Special thanks to the Obsidian community for feedback and testing.</p>
    `;
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

  /**
   * Populate a dropdown with available models.
   * Uses dynamic models from SDK if available, otherwise falls back to static list.
   */
  private populateModelDropdown(dropdown: import('obsidian').DropdownComponent): void {
    // Try to get dynamic models from SDK backend
    const backend = this.plugin.backendFactory?.getBackend();
    const dynamicModels = backend?.getAvailableModels?.();

    if (dynamicModels && dynamicModels.length > 0) {
      // Use dynamic models from SDK
      for (const model of dynamicModels) {
        dropdown.addOption(model.value, model.displayName);
      }
    } else {
      // Fallback to static list
      dropdown.addOption('claude-sonnet-4-5', 'Claude Sonnet 4.5 (Recommended)');
      dropdown.addOption('claude-opus-4-5', 'Claude Opus 4.5');
      dropdown.addOption('claude-opus-4', 'Claude Opus 4');
      dropdown.addOption('claude-haiku-3-5', 'Claude Haiku 3.5');
      dropdown.addOption('claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet (Legacy)');
    }
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

/**
 * Modal for entering API key securely.
 */
class ApiKeyModal extends Modal {
  private onSubmit: (key: string) => Promise<void>;

  constructor(app: App, onSubmit: (key: string) => Promise<void>) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Enter Anthropic API Key' });

    const desc = contentEl.createEl('p', {
      text: 'Your API key will be stored securely and will not appear in plugin settings.',
    });
    desc.style.marginBottom = '1rem';
    desc.style.color = 'var(--text-muted)';

    let keyValue = '';

    const inputContainer = contentEl.createDiv();
    inputContainer.style.marginBottom = '1rem';

    const input = inputContainer.createEl('input', {
      type: 'password',
      placeholder: 'sk-ant-api03-...',
    });
    input.style.width = '100%';
    input.style.padding = '0.5rem';
    input.oninput = () => {
      keyValue = input.value;
    };

    // Show/hide toggle
    const toggleContainer = inputContainer.createDiv();
    toggleContainer.style.marginTop = '0.5rem';

    const showToggle = toggleContainer.createEl('label');
    const checkbox = showToggle.createEl('input', { type: 'checkbox' });
    checkbox.style.marginRight = '0.5rem';
    showToggle.appendText('Show key');
    checkbox.onchange = () => {
      input.type = checkbox.checked ? 'text' : 'password';
    };

    // Buttons
    const buttonContainer = contentEl.createDiv();
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'flex-end';
    buttonContainer.style.gap = '0.5rem';

    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => this.close();

    const saveBtn = buttonContainer.createEl('button', {
      text: 'Save',
      cls: 'mod-cta',
    });
    saveBtn.onclick = async () => {
      if (!keyValue.trim()) {
        new Notice('Please enter an API key');
        return;
      }
      await this.onSubmit(keyValue.trim());
      this.close();
    };

    // Focus input
    input.focus();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
