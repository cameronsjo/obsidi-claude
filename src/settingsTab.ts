import { App, PluginSettingTab, Setting, Notice, Modal, TextComponent, TextAreaComponent, Platform, setIcon } from 'obsidian';
import type ObsidiClaudePlugin from '../main';
import type { EmbeddingProviderType, ExternalMCPServer } from './types';
import { createLogger } from './logger';

const log = createLogger('SettingsTab');

type SettingsTabId = 'agent' | 'embedding' | 'tools' | 'about';

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
    // Seed default state on first render
    if (!this.expandedSections.has(`__init_${id}`)) {
      this.expandedSections.add(`__init_${id}`);
      if (defaultExpanded) {
        this.expandedSections.add(id);
      }
    }

    const isExpanded = this.expandedSections.has(id);

    const headerEl = containerEl.createDiv({
      cls: `settings-section-header${isExpanded ? ' is-expanded' : ''}`,
    });
    headerEl.setAttribute('role', 'button');
    headerEl.setAttribute('tabindex', '0');
    headerEl.setAttribute('aria-expanded', String(isExpanded));

    const chevron = headerEl.createSpan({ cls: 'settings-section-chevron' });
    setIcon(chevron, 'chevron-right');

    headerEl.createSpan({ text: title, cls: 'settings-section-title' });

    const contentEl = containerEl.createDiv({
      cls: `settings-section-content${isExpanded ? ' is-expanded' : ''}`,
    });

    const toggle = () => {
      const nowExpanded = !this.expandedSections.has(id);
      if (nowExpanded) {
        this.expandedSections.add(id);
      } else {
        this.expandedSections.delete(id);
      }
      headerEl.toggleClass('is-expanded', nowExpanded);
      contentEl.toggleClass('is-expanded', nowExpanded);
      headerEl.setAttribute('aria-expanded', String(nowExpanded));
    };

    headerEl.addEventListener('click', toggle);
    headerEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });

    return contentEl;
  }

  /**
   * Render the API key setting with secure storage.
   * Shows status and provides set/clear buttons without exposing the actual key.
   */
  private async renderApiKeySetting(setting: Setting): Promise<void> {
    const source = await this.plugin.getApiKeySource();
    const hasKey = source !== null;
    const controlEl = setting.controlEl;

    // Clear any existing controls
    controlEl.empty();

    // Source labels for display
    const sourceLabels: Record<string, string> = {
      env: 'env var',
      plugin: 'plugin secret',
      shared: 'shared secret',
      legacy: 'settings (legacy)',
    };

    // Status indicator
    const statusEl = controlEl.createSpan({
      cls: `api-key-status ${hasKey ? 'configured' : 'not-configured'} obsidi-claude-api-key-status`,
    });
    const statusText = hasKey
      ? `✓ Using ${sourceLabels[source!]}`
      : '✗ Not configured';
    statusEl.setText(statusText);

    // Set/Update button (not needed if using env var)
    if (source !== 'env') {
      const setBtn = controlEl.createEl('button', {
        text: hasKey ? 'Update' : 'Set Key',
        cls: 'mod-cta obsidi-claude-api-key-btn',
      });
      setBtn.onclick = () => {
        new ApiKeyModal(this.app, async (key) => {
          await this.plugin.setApiKey(key);
          new Notice('API key saved securely');
          this.renderApiKeySetting(setting);
        }).open();
      };
    }

    // Clear button (only if key exists and not from env)
    if (hasKey && source !== 'env') {
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

    // Mobile notice
    if (Platform.isMobile) {
      const mobileNotice = containerEl.createDiv({ cls: 'setting-item-description obsidi-claude-mobile-notice' });
      const strong = mobileNotice.createEl('strong', { text: 'Mobile Mode' });
      mobileNotice.createEl('br');
      mobileNotice.appendText('Using the direct Anthropic API. Some desktop features (SDK backend, MCP servers, bash commands) are unavailable on mobile.');
    }

    // Tab bar
    const tabBar = containerEl.createDiv('settings-tab-bar');
    const allTabs: { id: SettingsTabId; label: string; desktopOnly?: boolean }[] = [
      { id: 'agent', label: 'Agent' },
      { id: 'embedding', label: 'Embedding' },
      { id: 'tools', label: 'Tools' },
      { id: 'about', label: 'About' },
    ];
    // Filter out desktop-only tabs on mobile
    const tabs = allTabs.filter(tab => !tab.desktopOnly || !Platform.isMobile);

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
      case 'tools':
        this.addToolSettings(contentEl);
        this.addExternalMCPSettings(contentEl);
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
      .setName('Include active note')
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
      .setName('Permission mode')
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
    const displaySection = this.createCollapsibleSection(containerEl, 'display', 'Display preferences', true);

    new Setting(displaySection)
      .setName('Show tool calls')
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
      .setName('Show message actions')
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
      .setName('Show thinking by default')
      .setDesc('Expand Claude\'s thinking blocks automatically in the chat pane.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showThinkingByDefault)
          .onChange(async (value) => {
            this.plugin.settings.showThinkingByDefault = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(displaySection)
      .setName('Stream responses')
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
    const limitsSection = this.createCollapsibleSection(containerEl, 'limits', 'Safety & limits');

    new Setting(limitsSection)
      .setName('Max budget (USD)')
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
      .setName('Max turns')
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
    const backendSection = this.createCollapsibleSection(containerEl, 'backend', 'Backend setup');

    // On mobile, only show API option; on desktop show all options
    if (Platform.isMobile) {
      const mobileBackendInfo = backendSection.createDiv({ cls: 'setting-item-description obsidi-claude-backend-info' });
      mobileBackendInfo.createEl('em', { text: 'Using direct Anthropic API (mobile)' });
    } else {
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
    }

    // Show current backend info
    const backendInfo = this.plugin.backendFactory?.getBackendInfo();
    if (backendInfo) {
      const infoEl = backendSection.createDiv({ cls: 'setting-item-description obsidi-claude-backend-current' });
      const em = infoEl.createEl('em');
      em.setText(`Current: ${backendInfo.current.toUpperCase()} backend (${backendInfo.sdkAvailable ? 'SDK available' : 'SDK unavailable'})`);
    }

    // API Key with secure storage
    const apiKeySetting = new Setting(backendSection)
      .setName('Anthropic API key')
      .setDesc('Required for API backend. Stored securely. Env var ANTHROPIC_API_KEY takes precedence.');

    // Add status indicator and buttons asynchronously
    this.renderApiKeySetting(apiKeySetting);

    // Desktop-only: Claude Code Path and Working Directory
    if (!Platform.isMobile) {
      new Setting(backendSection)
        .setName('Claude Code path')
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
        .setName('Working directory')
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
    }

    // ═══════════════════════════════════════════════════════════════════
    // STORAGE - Vault-based conversation storage for sync
    // ═══════════════════════════════════════════════════════════════════
    const storageSection = this.createCollapsibleSection(containerEl, 'storage', 'Conversation storage');

    const storageSettings = this.plugin.settings.conversationStorage;

    new Setting(storageSection)
      .setName('Store in vault')
      .setDesc('Save conversations to your vault for cross-device sync via Obsidian Sync')
      .addToggle((toggle) =>
        toggle
          .setValue(storageSettings.enabled)
          .onChange(async (value) => {
            if (value && !storageSettings.enabled) {
              // Enabling - check for migration
              const hasPrevious = await this.plugin.storage.hasPluginStorageConversations();
              if (hasPrevious) {
                const result = await this.plugin.storage.migrateToVaultStorage();
                new Notice(`Migrated ${result.migrated} conversations to vault storage`);
              } else {
                await this.plugin.storage.ensureVaultStorageDir();
                new Notice('Vault storage enabled');
              }
            }
            this.plugin.settings.conversationStorage.enabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(storageSection)
      .setName('Folder path')
      .setDesc('Vault folder for conversation files')
      .addText((text) =>
        text
          .setPlaceholder('.claude/conversations')
          .setValue(storageSettings.folderPath)
          .onChange(async (value) => {
            this.plugin.settings.conversationStorage.folderPath = value || '.claude/conversations';
            await this.plugin.saveSettings();
          })
      );

    new Setting(storageSection)
      .setName('Auto-resume')
      .setDesc('Automatically resume the last conversation on startup')
      .addToggle((toggle) =>
        toggle
          .setValue(storageSettings.autoResume)
          .onChange(async (value) => {
            this.plugin.settings.conversationStorage.autoResume = value;
            await this.plugin.saveSettings();
          })
      );

    // ═══════════════════════════════════════════════════════════════════
    // ADVANCED - Collapsible, collapsed by default
    // ═══════════════════════════════════════════════════════════════════
    const advancedSection = this.createCollapsibleSection(containerEl, 'advanced', 'Advanced');

    // System prompt
    new Setting(advancedSection)
      .setName('Custom instructions')
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

    // SDK-specific advanced settings (only on desktop if SDK available)
    if (!Platform.isMobile) {
      const backendFactory = this.plugin.backendFactory;
      if (backendFactory?.getBackendInfo().sdkAvailable) {
        this.addSDKAdvancedSettings(advancedSection);
      }
    }

    // Skills settings
    this.addSkillsSettings(advancedSection);
  }

  /**
   * Add skills-related settings to a container
   */
  private addSkillsSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Skills').setHeading();

    new Setting(containerEl)
      .setName('Enable skills')
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
        .setName('Skills folder')
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
        .setName('Install bundled skills')
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
        .setName('Loaded skills')
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
        const skillsListEl = containerEl.createDiv({ cls: 'setting-item-description obsidi-claude-skills-list' });
        skillsListEl.createEl('strong', { text: 'Active skills:' });
        skillsListEl.appendText(` ${skills.map(s => s.name).join(', ')}`);
      }
    }
  }

  private addSDKAdvancedSettings(containerEl: HTMLElement): void {
    // SDK Options header (nested in Advanced section)
    new Setting(containerEl).setName('SDK options').setHeading();

    // System prompt mode
    new Setting(containerEl)
      .setName('System prompt mode')
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
      .setName('Auto-continue session')
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
      .setName('File checkpointing')
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
      .setName('Extended context (1M tokens)')
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
      .setName('Load vault CLAUDE.md')
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
      .setName('Max thinking tokens')
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
      .setName('Additional directories')
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
      .setName('Blocked tools')
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
        .setName('Main agent')
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
      .setName('Fallback model')
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
      .setName('Ephemeral mode')
      .setDesc('Privacy mode - sessions not saved to disk')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.ephemeralMode).onChange(async (value) => {
          this.plugin.settings.ephemeralMode = value;
          await this.plugin.saveSettings();
        })
      );

    // Sandbox settings
    new Setting(containerEl).setName('Sandbox').setHeading();

    new Setting(containerEl)
      .setName('Sandbox mode')
      .setDesc('Run Bash commands in a sandboxed environment')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.sandboxEnabled).onChange(async (value) => {
          this.plugin.settings.sandboxEnabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Auto-allow Bash in sandbox')
      .setDesc('Auto-approve Bash when sandbox is enabled')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoAllowBashIfSandboxed).onChange(async (value) => {
          this.plugin.settings.autoAllowBashIfSandboxed = value;
          await this.plugin.saveSettings();
        })
      );

    // Hooks settings
    new Setting(containerEl).setName('Hooks').setHeading();

    new Setting(containerEl)
      .setName('Enable hooks')
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
        .setName('Auto-refresh vault')
        .setDesc('Refresh Obsidian after Claude edits files')
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.hooks.autoRefreshVault).onChange(async (value) => {
            this.plugin.settings.hooks.autoRefreshVault = value;
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName('Audit tool usage')
        .setDesc('Log all tool usage for debugging')
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.hooks.auditToolUsage).onChange(async (value) => {
            this.plugin.settings.hooks.auditToolUsage = value;
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName('Show SDK notifications')
        .setDesc('Display SDK notifications (may be verbose)')
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.hooks.showNotifications).onChange(async (value) => {
            this.plugin.settings.hooks.showNotifications = value;
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName('Hook blocked tools')
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
    new Setting(containerEl).setName('Context compaction').setHeading();

    new Setting(containerEl)
      .setName('Compaction instructions')
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
    new Setting(containerEl).setName('Semantic search (RAG)').setHeading();

    const embedding = this.plugin.settings.embedding;

    // Enable embeddings
    new Setting(containerEl)
      .setName('Enable semantic search')
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
      .setName('Embedding provider')
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
      const strongEl = warningEl.createEl('strong', { text: '⚠️  Performance Notice' });
      warningEl.appendText('Transformers.js runs in your browser and may cause brief UI freezes during indexing.');
      const ul = warningEl.createEl('ul');
      const li1 = ul.createEl('li');
      li1.createEl('strong', { text: 'Recommended for:' });
      li1.appendText(' Small vaults (<500 files)');
      const li2 = ul.createEl('li');
      li2.createEl('strong', { text: 'For larger vaults:' });
      li2.appendText(' Use Ollama (free, local, no UI blocking)');

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
      // Show warning on mobile
      if (Platform.isMobile) {
        const warningEl = containerEl.createDiv({ cls: 'setting-warning' });
        warningEl.createEl('strong', { text: '⚠️ Not Available on Mobile' });
        warningEl.createEl('br');
        warningEl.appendText('Ollama requires localhost access, which is not available on mobile devices. Please use ');
        warningEl.createEl('strong', { text: 'Transformers.js' });
        warningEl.appendText(' (free, in-browser) or a cloud provider (OpenAI, Voyage).');
      }

      new Setting(containerEl)
        .setName('Ollama host')
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
        .setName('OpenAI API key')
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
        .setName('Voyage AI API key')
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
    new Setting(containerEl).setName('Indexing options').setHeading();

    new Setting(containerEl)
      .setName('Auto-index')
      .setDesc('Automatically index files when they change')
      .addToggle((toggle) =>
        toggle.setValue(embedding.autoIndex).onChange(async (value) => {
          this.plugin.settings.embedding.autoIndex = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Chunk size')
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
      .setName('Chunk overlap')
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
      .setName('Excluded folders')
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
      .setName('Index actions')
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
      const statsEl = containerEl.createDiv({ cls: 'setting-item-description obsidi-claude-index-stats' });
      statsEl.createEl('strong', { text: 'Index Status:' });
      statsEl.createEl('br');
      statsEl.appendText(`Provider: ${stats.providerName || 'Not configured'}`);
      statsEl.createEl('br');
      statsEl.appendText(`Files indexed: ${stats.totalFiles}`);
      statsEl.createEl('br');
      statsEl.appendText(`Total chunks: ${stats.totalChunks}`);
    }
  }

  private addExternalMCPSettings(containerEl: HTMLElement): void {
    // Client section - connect to external MCP servers
    const clientSection = this.createCollapsibleSection(
      containerEl,
      'mcp-client',
      'Client (External Servers)',
      true
    );

    const servers = this.plugin.settings.externalMcpServers;

    // Add server button
    new Setting(clientSection)
      .setName('Add MCP server')
      .setDesc('Connect to external MCP servers for additional capabilities')
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
      const serversContainer = clientSection.createDiv('mcp-servers-list');

      for (let i = 0; i < servers.length; i++) {
        const server = servers[i];
        const serverEl = serversContainer.createDiv('mcp-server-item');

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
    new Setting(containerEl).setName('Allowed tools').setHeading();
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
    const heroEl = containerEl.createDiv({ cls: 'obsidi-claude-hero' });

    const titleEl = heroEl.createDiv({ cls: 'obsidi-claude-hero-title' });
    titleEl.setText('Obsidi-Claude');

    const versionEl = heroEl.createDiv({ cls: 'obsidi-claude-hero-version' });
    versionEl.setText(`Version ${manifest.version}`);

    const descEl = heroEl.createDiv({ cls: 'obsidi-claude-hero-desc' });
    descEl.setText(manifest.description);

    // Links section
    new Setting(containerEl).setName('Links').setHeading();

    new Setting(containerEl)
      .setName('GitHub repository')
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
      .setName('Report issue')
      .setDesc('Found a bug? Let us know!')
      .addButton((button) =>
        button.setButtonText('Report').onClick(() => {
          window.open('https://github.com/cameronsjo/obsidi-claude/issues/new', '_blank');
        })
      );

    // System info section
    new Setting(containerEl).setName('System information').setHeading();

    const infoEl = containerEl.createDiv({ cls: 'obsidi-claude-sysinfo' });

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

    for (const line of infoLines) {
      infoEl.createDiv({ text: line as string });
    }

    // Copy system info button
    new Setting(containerEl)
      .setName('Copy system info')
      .setDesc('Copy system information for bug reports')
      .addButton((button) =>
        button.setButtonText('Copy').onClick(() => {
          const info = infoLines.join('\n');
          navigator.clipboard.writeText(info);
          new Notice('System info copied to clipboard');
        })
      );

    // Credits
    new Setting(containerEl).setName('Credits').setHeading();

    const creditsEl = containerEl.createDiv({ cls: 'obsidi-claude-credits' });
    const p1 = creditsEl.createEl('p');
    p1.appendText('Created by ');
    p1.createEl('a', { text: manifest.author, href: manifest.authorUrl, attr: { target: '_blank' } });

    const p2 = creditsEl.createEl('p');
    p2.appendText('Powered by ');
    p2.createEl('a', { text: 'Claude', href: 'https://www.anthropic.com/claude', attr: { target: '_blank' } });
    p2.appendText(' and the ');
    p2.createEl('a', { text: 'Claude Agent SDK', href: 'https://github.com/anthropics/claude-code', attr: { target: '_blank' } });

    const p3 = creditsEl.createEl('p', { cls: 'obsidi-claude-credits-thanks' });
    p3.setText('Special thanks to the Obsidian community for feedback and testing.');
  }

  private addResetSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Reset').setHeading();

    new Setting(containerEl)
      .setName('Reset to defaults')
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

    this.setTitle(this.existing ? 'Edit MCP server' : 'Add MCP server');

    // Name
    new Setting(contentEl)
      .setName('Server name')
      .setDesc('Unique name for this MCP server (e.g., "mouse", "media")')
      .addText((text) => {
        this.nameInput = text;
        text
          .setPlaceholder('my-server')
          .setValue(this.existing?.name || '');
        text.inputEl.addClass('obsidi-claude-modal-input-full');
      });

    // Command
    new Setting(contentEl)
      .setName('Command')
      .setDesc('Executable to run (e.g., "node", "npx", "python")')
      .addText((text) => {
        this.commandInput = text;
        text
          .setPlaceholder('node')
          .setValue(this.existing?.command || 'node');
        text.inputEl.addClass('obsidi-claude-modal-input-full');
      });

    // Args
    new Setting(contentEl)
      .setName('Arguments')
      .setDesc('Command arguments, space-separated (e.g., "dist/index.js" or "tsx src/index.ts")')
      .addText((text) => {
        this.argsInput = text;
        text
          .setPlaceholder('/path/to/server/dist/index.js')
          .setValue(this.existing?.args.join(' ') || '');
        text.inputEl.addClass('obsidi-claude-modal-input-full');
      });

    // Environment variables
    new Setting(contentEl)
      .setName('Environment variables')
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
        text.inputEl.addClass('obsidi-claude-modal-input-full');
      });

    // Buttons
    const buttonContainer = contentEl.createDiv({ cls: 'obsidi-claude-modal-buttons' });

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
    this.setTitle('Enter Anthropic API key');

    const desc = contentEl.createEl('p', {
      text: 'Your API key will be stored securely and will not appear in plugin settings.',
      cls: 'obsidi-claude-modal-desc',
    });

    let keyValue = '';

    const inputContainer = contentEl.createDiv({ cls: 'obsidi-claude-modal-input-container' });

    const input = inputContainer.createEl('input', {
      type: 'password',
      placeholder: 'sk-ant-api03-...',
      cls: 'obsidi-claude-modal-key-input',
    });
    input.oninput = () => {
      keyValue = input.value;
    };

    // Show/hide toggle
    const toggleContainer = inputContainer.createDiv({ cls: 'obsidi-claude-modal-toggle-row' });

    const showToggle = toggleContainer.createEl('label');
    const checkbox = showToggle.createEl('input', { type: 'checkbox', cls: 'obsidi-claude-modal-checkbox' });
    showToggle.appendText('Show key');
    checkbox.onchange = () => {
      input.type = checkbox.checked ? 'text' : 'password';
    };

    // Buttons
    const buttonContainer = contentEl.createDiv({ cls: 'obsidi-claude-modal-buttons' });

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
