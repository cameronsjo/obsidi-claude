/**
 * Status bar module for ChatView.
 * Displays backend, context, account, and token information.
 *
 * The module works with two container areas:
 * - badgesContainer: In the header, holds backend/context/account/ephemeral badges
 * - tokenContainer: In the input area, holds the token counter
 */
import { setIcon } from 'obsidian';
import type { ModuleDeps, ModuleHandle } from './types';

/**
 * Backend provider information.
 */
export interface BackendInfo {
  type: string;
  label: string;
}

/**
 * Active context/note information.
 */
export interface ContextInfo {
  path: string;
  title: string;
}

/**
 * Account information.
 */
export interface AccountInfo {
  name?: string;
  email?: string;
  tier?: string;
}

/**
 * Token usage and cost information.
 */
export interface TokenInfo {
  tokens: number;
  cost: number;
}

/**
 * Callbacks for status bar to communicate with parent.
 */
export interface StatusBarCallbacks {
  onBackendClick: () => void;
  onContextClick: () => void;
  onAccountClick: () => void;
  onTokenCounterClick: () => void;
  getBackendInfo: () => BackendInfo;
  getActiveNoteInfo: () => ContextInfo | null;
  getAccountInfo: () => AccountInfo | null;
  getTokenEstimate: () => TokenInfo;
}

/**
 * Container configuration for status bar.
 */
export interface StatusBarContainers {
  /** Container for badges (in header area) */
  badgesContainer: HTMLElement;
  /** Container for token counter (in input area) */
  tokenContainer: HTMLElement;
}

/**
 * Handle for controlling the status bar.
 */
export interface StatusBarHandle extends ModuleHandle {
  updateBackend(info: BackendInfo): void;
  updateContext(info: ContextInfo | null): void;
  updateAccount(info: AccountInfo | null): void;
  updateTokens(info: TokenInfo): void;
  updateEphemeral(active: boolean): void;
  refresh(): void;
}

/**
 * Create a status bar for displaying chat metadata.
 * @param containers - Container elements for badges and token counter
 * @param _deps - Module dependencies (reserved for future use)
 * @param callbacks - Callbacks for parent communication
 */
export function createStatusBar(
  containers: StatusBarContainers,
  _deps: ModuleDeps,
  callbacks: StatusBarCallbacks
): StatusBarHandle {
  const { badgesContainer, tokenContainer } = containers;

  // Backend badge
  const backendBadge = badgesContainer.createDiv('backend-badge');
  backendBadge.onclick = (): void => callbacks.onBackendClick();

  // Ephemeral badge (hidden by default)
  const ephemeralBadge = badgesContainer.createDiv('ephemeral-badge');
  ephemeralBadge.setText('\u{1F512}');
  ephemeralBadge.setAttribute('aria-label', 'Ephemeral mode - sessions not saved');
  ephemeralBadge.style.display = 'none';

  // Context badge (hidden by default)
  const contextBadge = badgesContainer.createDiv('context-badge');
  contextBadge.setAttribute('aria-label', 'Active note included as context');
  contextBadge.style.display = 'none';
  contextBadge.onclick = (): void => callbacks.onContextClick();

  // Account badge (hidden by default)
  const accountBadge = badgesContainer.createDiv('account-badge');
  accountBadge.style.display = 'none';
  accountBadge.onclick = (): void => callbacks.onAccountClick();

  // Token counter (in separate container)
  const tokenCounter = tokenContainer.createSpan('chat-token-counter');
  tokenCounter.onclick = (): void => callbacks.onTokenCounterClick();

  function updateBackend(info: BackendInfo): void {
    backendBadge.empty();
    backendBadge.setText(info.label);
    backendBadge.className = `backend-badge backend-${info.type}`;
    backendBadge.setAttribute(
      'aria-label',
      info.type === 'sdk'
        ? 'Using Claude Code SDK (full features)'
        : 'Using direct API (mobile compatible)'
    );
  }

  function updateContext(info: ContextInfo | null): void {
    contextBadge.empty();
    if (info) {
      // Show badge with file icon and truncated name
      const displayName =
        info.title.length > 15 ? info.title.slice(0, 12) + '...' : info.title;
      setIcon(contextBadge, 'file-text');
      contextBadge.createSpan({ text: displayName });
      contextBadge.style.display = 'flex';
      contextBadge.setAttribute('aria-label', `Context: ${info.path}`);
    } else {
      contextBadge.style.display = 'none';
    }
  }

  function updateAccount(info: AccountInfo | null): void {
    if (info && (info.name || info.email || info.tier)) {
      // Display subscription type or account name
      const displayText = info.tier || info.name || 'Pro';
      accountBadge.empty();
      accountBadge.setText(displayText);
      accountBadge.className = 'account-badge';
      accountBadge.style.display = 'inline-flex';

      // Build tooltip with available info
      const tooltipParts: string[] = [];
      if (info.email) {
        tooltipParts.push(`Account: ${info.email}`);
      }
      if (info.name) {
        tooltipParts.push(`Org: ${info.name}`);
      }
      if (info.tier) {
        tooltipParts.push(`Plan: ${info.tier}`);
      }
      accountBadge.setAttribute(
        'aria-label',
        tooltipParts.join(' | ') || 'Authenticated'
      );
    } else {
      accountBadge.style.display = 'none';
    }
  }

  function updateTokens(info: TokenInfo): void {
    // Show nothing if no tokens and no cost
    if (info.tokens === 0 && info.cost === 0) {
      tokenCounter.style.display = 'none';
      return;
    }

    // Build display string
    const parts: string[] = [];

    // Token estimate (for current context)
    if (info.tokens > 0) {
      const formatted =
        info.tokens >= 1000
          ? `${(info.tokens / 1000).toFixed(1)}K`
          : info.tokens.toString();
      parts.push(`~${formatted} tokens`);
    }

    // Actual cost from usage tracking
    if (info.cost > 0) {
      parts.push(`$${info.cost.toFixed(4)}`);
    }

    tokenCounter.setText(parts.join(' \u00B7 '));
    tokenCounter.style.display = 'inline';
    tokenCounter.setAttribute(
      'aria-label',
      `Estimated ${info.tokens.toLocaleString()} tokens in context` +
        (info.cost > 0 ? `, session cost: $${info.cost.toFixed(4)}` : '')
    );
  }

  function updateEphemeral(active: boolean): void {
    ephemeralBadge.style.display = active ? 'inline-flex' : 'none';
  }

  function refresh(): void {
    updateBackend(callbacks.getBackendInfo());
    updateContext(callbacks.getActiveNoteInfo());
    updateAccount(callbacks.getAccountInfo());
    updateTokens(callbacks.getTokenEstimate());
  }

  function destroy(): void {
    // Clean up created elements
    backendBadge.remove();
    ephemeralBadge.remove();
    contextBadge.remove();
    accountBadge.remove();
    tokenCounter.remove();
  }

  // Initial refresh
  refresh();

  return {
    updateBackend,
    updateContext,
    updateAccount,
    updateTokens,
    updateEphemeral,
    refresh,
    destroy,
  };
}
