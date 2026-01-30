import { Platform } from 'obsidian';
import type { ObsidiClaudeSettings } from '../types';
import type { ObsidianTools } from '../obsidianTools';
import type { AgentBackend } from './agentBackend';
import { SDKAgentBackend, type HookCallbacks } from './sdkAgentBackend';
import { APIAgentBackend } from './apiAgentBackend';
import { createLogger } from '../logger';

const log = createLogger('BackendFactory');

/**
 * Factory for creating the appropriate agent backend based on platform and settings.
 *
 * Platform detection:
 * - Desktop: Prefers SDK backend (full Claude Agent SDK features)
 * - Mobile: Uses API backend (direct Anthropic API, lighter)
 *
 * The user can override this via settings.preferredBackend.
 */
export class BackendFactory {
  private sdkBackend: SDKAgentBackend | null = null;
  private apiBackend: APIAgentBackend | null = null;
  private currentBackend: AgentBackend | null = null;

  constructor(
    private settings: ObsidiClaudeSettings,
    private obsidianTools: ObsidianTools
  ) {}

  /**
   * Get the appropriate backend for current platform and settings.
   *
   * Selection logic:
   * 1. If preferredBackend is 'sdk' or 'api', use that if available
   * 2. If 'auto':
   *    - Desktop: Try SDK first, fall back to API
   *    - Mobile: Use API only
   */
  getBackend(): AgentBackend {
    const preferred = this.settings.preferredBackend;
    log.debug('Getting backend', { preferred, isDesktop: Platform.isDesktopApp, isMobile: Platform.isMobile });

    // Honor explicit preference if possible
    if (preferred === 'sdk') {
      const sdk = this.getSDKBackend();
      if (sdk?.isAvailable()) {
        log.info('Using SDK backend (explicit preference)');
        this.currentBackend = sdk;
        return sdk;
      }
      log.warn('SDK backend requested but not available, falling back to API');
    }

    if (preferred === 'api') {
      const api = this.getAPIBackend();
      log.info('Using API backend (explicit preference)');
      this.currentBackend = api;
      return api;
    }

    // Auto mode
    if (Platform.isDesktopApp) {
      const sdk = this.getSDKBackend();
      if (sdk?.isAvailable()) {
        log.info('Using SDK backend (desktop auto-detection)');
        this.currentBackend = sdk;
        return sdk;
      }
      log.info('SDK backend not available on desktop, using API backend');
    }

    // Mobile or fallback
    const api = this.getAPIBackend();
    log.info('Using API backend', { reason: Platform.isMobile ? 'mobile' : 'fallback' });
    this.currentBackend = api;
    return api;
  }

  /**
   * Get the SDK backend instance (desktop only).
   * Returns null on mobile.
   */
  getSDKBackend(): SDKAgentBackend | null {
    if (Platform.isMobile) {
      return null;
    }

    if (!this.sdkBackend) {
      this.sdkBackend = new SDKAgentBackend(this.settings, this.obsidianTools);
    }
    return this.sdkBackend;
  }

  /**
   * Get the API backend instance (always available).
   */
  getAPIBackend(): APIAgentBackend {
    if (!this.apiBackend) {
      this.apiBackend = new APIAgentBackend(this.settings, this.obsidianTools);
    }
    return this.apiBackend;
  }

  /**
   * Get the currently active backend.
   */
  getCurrentBackend(): AgentBackend | null {
    return this.currentBackend;
  }

  /**
   * Update settings for all backends.
   */
  updateSettings(settings: ObsidiClaudeSettings): void {
    this.settings = settings;
    this.sdkBackend?.updateSettings(settings);
    this.apiBackend?.updateSettings(settings);
  }

  /**
   * Dispose all backends.
   */
  async dispose(): Promise<void> {
    await Promise.all([
      this.sdkBackend?.dispose(),
      this.apiBackend?.dispose(),
    ]);
    this.sdkBackend = null;
    this.apiBackend = null;
    this.currentBackend = null;
  }

  /**
   * Check if the current platform supports the SDK backend.
   */
  isSDKAvailable(): boolean {
    return Platform.isDesktopApp && (this.getSDKBackend()?.isAvailable() ?? false);
  }

  /**
   * Set hook callbacks for the SDK backend.
   * This enables vault refresh, notifications, etc.
   */
  setHookCallbacks(callbacks: HookCallbacks): void {
    this.sdkBackend?.setHookCallbacks(callbacks);
  }

  /**
   * Dynamically set MCP servers at runtime (SDK backend only).
   */
  async setMcpServers(
    servers: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; type?: 'stdio' | 'http' | 'sse'; url?: string; headers?: Record<string, string> }>
  ): Promise<{ added: string[]; removed: string[]; errors: Record<string, string> } | null> {
    return this.sdkBackend?.setMcpServers(servers) ?? null;
  }

  /**
   * Get MCP server status (SDK backend only).
   */
  async getMcpServerStatus(): Promise<Array<{ name: string; status: string; error?: string }> | null> {
    return this.sdkBackend?.mcpServerStatus() ?? null;
  }

  /**
   * Toggle MCP server enabled state (SDK backend only).
   */
  async toggleMcpServer(name: string, enabled: boolean): Promise<boolean> {
    return this.sdkBackend?.toggleMcpServer(name, enabled) ?? false;
  }

  /**
   * Reconnect a failed MCP server (SDK backend only).
   */
  async reconnectMcpServer(name: string): Promise<boolean> {
    return this.sdkBackend?.reconnectMcpServer(name) ?? false;
  }

  /**
   * Get info about available backends for UI display.
   */
  getBackendInfo(): {
    current: 'sdk' | 'api';
    sdkAvailable: boolean;
    apiAvailable: boolean;
    platform: 'desktop' | 'mobile';
  } {
    return {
      current: this.currentBackend?.type ?? 'api',
      sdkAvailable: this.isSDKAvailable(),
      apiAvailable: true, // API is always available if we have a key
      platform: Platform.isMobile ? 'mobile' : 'desktop',
    };
  }
}
