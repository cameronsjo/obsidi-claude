import { Modal, App } from 'obsidian';
import type { PermissionRequestContext, PermissionResponse } from './backends/sdkAgentBackend';

/**
 * Modal for handling tool permission requests with native Obsidian UI.
 */
export class PermissionModal extends Modal {
  private context: PermissionRequestContext;
  private resolve: (response: PermissionResponse) => void;

  constructor(app: App, context: PermissionRequestContext, resolve: (response: PermissionResponse) => void) {
    super(app);
    this.context = context;
    this.resolve = resolve;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('permission-modal');

    // Header
    const header = contentEl.createDiv('permission-modal-header');
    header.createEl('h2', { text: 'Permission Required' });

    // Tool info
    const toolInfo = contentEl.createDiv('permission-modal-tool');
    toolInfo.createEl('span', { text: 'Tool: ', cls: 'permission-label' });
    toolInfo.createEl('code', { text: this.context.toolName, cls: 'permission-tool-name' });

    // Agent context (if from subagent)
    if (this.context.agentID) {
      const agentInfo = contentEl.createDiv('permission-modal-agent');
      agentInfo.createEl('span', { text: 'Agent: ', cls: 'permission-label' });
      agentInfo.createEl('code', { text: this.context.agentID, cls: 'permission-agent-id' });
    }

    // Decision reason
    if (this.context.decisionReason) {
      const reasonDiv = contentEl.createDiv('permission-modal-reason');
      reasonDiv.createEl('span', { text: 'Reason: ', cls: 'permission-label' });
      reasonDiv.createEl('span', { text: this.context.decisionReason, cls: 'permission-reason-text' });
    }

    // Blocked path (for file access)
    if (this.context.blockedPath) {
      const pathDiv = contentEl.createDiv('permission-modal-path');
      pathDiv.createEl('span', { text: 'Path: ', cls: 'permission-label' });
      pathDiv.createEl('code', { text: this.context.blockedPath, cls: 'permission-path' });
    }

    // Input preview
    if (Object.keys(this.context.input).length > 0) {
      const inputSection = contentEl.createDiv('permission-modal-input');
      inputSection.createEl('h4', { text: 'Input Parameters:' });
      const pre = inputSection.createEl('pre', { cls: 'permission-input-preview' });
      pre.createEl('code', {
        text: JSON.stringify(this.context.input, null, 2).slice(0, 500) +
          (JSON.stringify(this.context.input).length > 500 ? '\n...' : ''),
      });
    }

    // Buttons
    const buttonContainer = contentEl.createDiv('permission-modal-buttons');

    // Deny button
    const denyBtn = buttonContainer.createEl('button', {
      text: 'Deny',
      cls: 'permission-btn permission-btn-deny',
    });
    denyBtn.onclick = () => {
      this.resolve({ allowed: false, denyMessage: 'User denied permission' });
      this.close();
    };

    // Allow once button
    const allowOnceBtn = buttonContainer.createEl('button', {
      text: 'Allow Once',
      cls: 'permission-btn permission-btn-allow-once',
    });
    allowOnceBtn.onclick = () => {
      this.resolve({ allowed: true, applyAlwaysAllow: false });
      this.close();
    };

    // Always allow button (if suggestions available)
    if (this.context.suggestions && this.context.suggestions.length > 0) {
      const alwaysAllowBtn = buttonContainer.createEl('button', {
        text: 'Always Allow',
        cls: 'permission-btn permission-btn-always-allow mod-cta',
      });
      alwaysAllowBtn.onclick = () => {
        this.resolve({ allowed: true, applyAlwaysAllow: true });
        this.close();
      };
    }
  }

  onClose(): void {
    // If modal is closed without a decision (e.g., Escape key), deny by default
    // The resolve may have already been called by a button click
    this.resolve({ allowed: false, denyMessage: 'User closed permission dialog', interrupt: false });
  }
}
