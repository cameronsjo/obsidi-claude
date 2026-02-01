/**
 * Status bar module for ChatView.
 * Displays backend, context, account, and token information.
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
 * Format token cost with appropriate decimal places.
 * - cost >= 0.01: 2 decimal places
 * - cost > 0 but < 0.01: 4 decimal places
 * - cost == 0: $0.00
 */
function formatCost(cost: number): string {
  if (cost === 0) {
    return '$0.00';
  }
  if (cost >= 0.01) {
    return `$${cost.toFixed(2)}`;
  }
  return `$${cost.toFixed(4)}`;
}

/**
 * Create a status bar for displaying chat metadata.
 * @param container - Parent element to attach the status bar to
 * @param _deps - Module dependencies (reserved for future use)
 * @param callbacks - Callbacks for parent communication
 */
export function createStatusBar(
  container: HTMLElement,
  _deps: ModuleDeps,
  callbacks: StatusBarCallbacks
): StatusBarHandle {
  // DOM elements
  const badgesContainer = container.createDiv('chat-badges');

  // Backend badge
  const backendBadge = badgesContainer.createDiv('backend-badge');
  const backendIcon = backendBadge.createSpan('badge-icon');
  setIcon(backendIcon, 'cpu');
  const backendLabel = backendBadge.createSpan('badge-label');
  backendBadge.onclick = (): void => callbacks.onBackendClick();

  // Context badge (hidden by default)
  const contextBadge = badgesContainer.createDiv('context-badge');
  contextBadge.style.display = 'none';
  const contextIcon = contextBadge.createSpan('badge-icon');
  setIcon(contextIcon, 'file-text');
  const contextLabel = contextBadge.createSpan('badge-label');
  contextBadge.onclick = (): void => callbacks.onContextClick();

  // Account badge (hidden by default)
  const accountBadge = badgesContainer.createDiv('account-badge');
  accountBadge.style.display = 'none';
  const accountIcon = accountBadge.createSpan('badge-icon');
  setIcon(accountIcon, 'user');
  const accountLabel = accountBadge.createSpan('badge-label');
  accountBadge.onclick = (): void => callbacks.onAccountClick();

  // Ephemeral badge (hidden by default)
  const ephemeralBadge = badgesContainer.createDiv('ephemeral-badge');
  ephemeralBadge.style.display = 'none';
  const ephemeralIcon = ephemeralBadge.createSpan('badge-icon');
  setIcon(ephemeralIcon, 'ghost');
  const ephemeralLabel = ephemeralBadge.createSpan('badge-label');
  ephemeralLabel.textContent = 'Ephemeral';

  // Token counter
  const tokenCounter = badgesContainer.createDiv('chat-token-counter');
  tokenCounter.onclick = (): void => callbacks.onTokenCounterClick();

  function updateBackend(info: BackendInfo): void {
    backendBadge.setAttribute('data-type', info.type);
    backendLabel.textContent = info.label;
  }

  function updateContext(info: ContextInfo | null): void {
    if (info) {
      contextBadge.style.display = '';
      contextBadge.setAttribute('title', info.path);
      contextLabel.textContent = info.title;
    } else {
      contextBadge.style.display = 'none';
    }
  }

  function updateAccount(info: AccountInfo | null): void {
    if (info && (info.name || info.email)) {
      accountBadge.style.display = '';
      accountLabel.textContent = info.name || info.email || '';
    } else {
      accountBadge.style.display = 'none';
    }
  }

  function updateTokens(info: TokenInfo): void {
    tokenCounter.textContent = `~${info.tokens} tokens (${formatCost(info.cost)})`;
  }

  function updateEphemeral(active: boolean): void {
    ephemeralBadge.style.display = active ? '' : 'none';
  }

  function refresh(): void {
    updateBackend(callbacks.getBackendInfo());
    updateContext(callbacks.getActiveNoteInfo());
    updateAccount(callbacks.getAccountInfo());
    updateTokens(callbacks.getTokenEstimate());
  }

  function destroy(): void {
    badgesContainer.remove();
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
