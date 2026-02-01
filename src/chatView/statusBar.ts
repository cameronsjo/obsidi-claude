/**
 * Status bar module for ChatView.
 * Manages status indicators: backend badge, context badge, ephemeral badge, token counter.
 */
import { setIcon } from 'obsidian';
import type { ModuleDeps, ModuleHandle, Conversation } from './types';

const CHARS_PER_TOKEN_ESTIMATE = 4;

export interface StatusBarCallbacks {
  getBackendType: () => string;
  getEphemeralMode: () => boolean;
  getActiveNoteContext: () => boolean;
  getActiveFile: () => { basename: string; path: string; extension: string } | null;
  getConversation: () => Conversation;
  getSystemPrompt: () => string;
}

export interface StatusBarHandle extends ModuleHandle {
  updateBackendBadge(): void;
  updateEphemeralBadge(): void;
  updateContextBadge(): void;
  updateTokenCounter(): void;
  getTokenCounterElement(): HTMLElement;
}

export function createStatusBar(
  container: HTMLElement,
  deps: ModuleDeps,
  callbacks: StatusBarCallbacks
): StatusBarHandle {
  // Create status indicators container
  const statusIndicators = container.createDiv('header-status');

  // Backend indicator badge
  const backendBadge = statusIndicators.createDiv('backend-badge');

  // Ephemeral mode indicator
  const ephemeralBadge = statusIndicators.createDiv('ephemeral-badge');
  ephemeralBadge.setText('\uD83D\uDD12');
  ephemeralBadge.setAttribute('aria-label', 'Ephemeral mode - sessions not saved');

  // Context indicator
  const contextBadge = statusIndicators.createDiv('context-badge');
  contextBadge.setAttribute('aria-label', 'Active note included as context');

  // Token counter (can be placed elsewhere)
  const tokenCounter = container.createSpan('chat-token-counter');

  function updateBackendBadge(): void {
    const type = callbacks.getBackendType().toUpperCase();
    backendBadge.empty();
    backendBadge.setText(type);
    backendBadge.className = `backend-badge backend-${callbacks.getBackendType()}`;
    backendBadge.setAttribute(
      'aria-label',
      callbacks.getBackendType() === 'sdk'
        ? 'Using Claude Code SDK (full features)'
        : 'Using direct API (mobile compatible)'
    );
  }

  function updateEphemeralBadge(): void {
    ephemeralBadge.style.display = callbacks.getEphemeralMode() ? 'inline-flex' : 'none';
  }

  function updateContextBadge(): void {
    contextBadge.empty();

    const enabled = callbacks.getActiveNoteContext();
    const activeFile = callbacks.getActiveFile();
    const hasActiveNote = activeFile && activeFile.extension === 'md';

    if (enabled && hasActiveNote) {
      const fileName = activeFile.basename;
      const displayName = fileName.length > 15 ? fileName.slice(0, 12) + '...' : fileName;
      setIcon(contextBadge, 'file-text');
      contextBadge.createSpan({ text: displayName });
      contextBadge.style.display = 'flex';
      contextBadge.setAttribute('aria-label', `Context: ${activeFile.path}`);
    } else {
      contextBadge.style.display = 'none';
    }
  }

  function estimateTokens(): number {
    const conversation = callbacks.getConversation();
    let totalChars = 0;

    // Count message content
    for (const msg of conversation.messages) {
      totalChars += msg.content.length;
      totalChars += 20; // Overhead for role and structure
    }

    // System prompt
    totalChars += callbacks.getSystemPrompt().length;

    return Math.ceil(totalChars / CHARS_PER_TOKEN_ESTIMATE);
  }

  function updateTokenCounter(): void {
    const tokens = estimateTokens();
    const conversation = callbacks.getConversation();
    const usage = conversation?.usage;
    const totalCost = usage?.totalCost ?? 0;

    // Show nothing if no tokens and no cost
    if (tokens === 0 && totalCost === 0) {
      tokenCounter.style.display = 'none';
      return;
    }

    // Build display string
    const parts: string[] = [];

    // Token estimate
    if (tokens > 0) {
      const formatted = tokens >= 1000
        ? `${(tokens / 1000).toFixed(1)}K`
        : tokens.toString();
      parts.push(`~${formatted} tokens`);
    }

    // Actual cost from usage tracking
    if (totalCost > 0) {
      parts.push(`$${totalCost.toFixed(4)}`);
    }

    tokenCounter.setText(parts.join(' \u00b7 '));
    tokenCounter.style.display = 'inline';
    tokenCounter.setAttribute(
      'aria-label',
      `Estimated ${tokens.toLocaleString()} tokens in context` +
        (totalCost > 0 ? `, session cost: $${totalCost.toFixed(4)}` : '')
    );
  }

  // Initial updates
  updateBackendBadge();
  updateEphemeralBadge();
  updateContextBadge();
  updateTokenCounter();

  function destroy(): void {
    statusIndicators.remove();
    tokenCounter.remove();
  }

  return {
    updateBackendBadge,
    updateEphemeralBadge,
    updateContextBadge,
    updateTokenCounter,
    getTokenCounterElement: () => tokenCounter,
    destroy,
  };
}
