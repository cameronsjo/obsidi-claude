# Obsidian Claude Chat Plugin Research

> Research compiled: 2025-12-25
> Project: obsidi-claude - Chat application using Claude Code SDK as an Obsidian plugin

## Table of Contents

- [Executive Summary](#executive-summary)
- [Architecture Decision](#architecture-decision)
- [Obsidian Plugin Development](#obsidian-plugin-development)
- [Claude Integration Options](#claude-integration-options)
- [Happy Coder Patterns](#happy-coder-patterns)
- [Recommended Implementation Plan](#recommended-implementation-plan)

---

## Executive Summary

Building a chat application as an Obsidian plugin with Claude integration requires understanding three domains:

1. **Obsidian Plugin Architecture** - ItemView for sidebar chat, Settings for API key, Event system for lifecycle
2. **Claude SDK Options** - Agent SDK (powerful but complex) vs REST API (simpler, recommended)
3. **Happy Coder Patterns** - Real-time sync, encryption, permission system, streaming UI

**Key Finding:** The Claude Agent SDK requires Claude Code as its runtime, which is challenging in Electron. For an Obsidian plugin, the **Anthropic REST API** (`@anthropic-ai/sdk`) is recommended over the Agent SDK.

---

## Architecture Decision

### Option A: REST API (Recommended)

```
Obsidian Plugin ─► Anthropic REST API ─► Claude Model
                   (direct HTTPS calls)
```

**Pros:**
- Simple integration - just HTTP calls
- Works natively in Electron/browser
- Full streaming support
- No external dependencies

**Cons:**
- No built-in file/shell tools (you'd implement custom tools)
- Manual conversation management

### Option B: Agent SDK with Backend

```
Obsidian Plugin ─► WebSocket ─► Backend Server ─► Claude Agent SDK
                                                  ─► Claude Code CLI
```

**Pros:**
- Full Agent SDK capabilities (file ops, shell, web search)
- Session resumption built-in
- Can leverage Claude Code's 100+ built-in tools

**Cons:**
- Requires separate backend server
- More complex architecture
- Higher operational overhead

### Option C: Hybrid (Happy Coder Style)

```
Obsidian Plugin ◄─► Relay Server ◄─► CLI (with Claude Code)
     (viewer)       (encrypted)       (execution)
```

**Pros:**
- Best of both worlds
- End-to-end encryption
- Mobile/desktop sync capability

**Cons:**
- Most complex architecture
- Requires three components

**Recommendation:** Start with **Option A** (REST API) for MVP, evolve to Option C if you need advanced features.

---

## Obsidian Plugin Development

### Plugin Structure

```
obsidi-claude/
├── manifest.json        # Plugin metadata
├── main.ts              # Entry point
├── styles.css           # Chat UI styles
├── esbuild.config.mjs   # Build configuration
├── package.json
├── tsconfig.json
├── src/
│   ├── ChatView.ts      # Sidebar chat view
│   ├── SettingsTab.ts   # Settings UI
│   ├── api/
│   │   └── claude.ts    # Claude API client
│   └── types.ts         # Type definitions
└── README.md
```

### manifest.json

```json
{
  "id": "obsidi-claude",
  "name": "Obsidi-Claude",
  "version": "0.1.0",
  "minAppVersion": "1.0.0",
  "description": "Chat with Claude AI directly in Obsidian",
  "author": "Cameron",
  "isDesktopOnly": false
}
```

### Main Plugin Entry

```typescript
import { Plugin, WorkspaceLeaf } from 'obsidian';
import { ChatView, CHAT_VIEW_TYPE } from './src/ChatView';
import { SettingsTab } from './src/SettingsTab';
import { DEFAULT_SETTINGS, ObsidiClaudeSettings } from './src/types';

export default class ObsidiClaudePlugin extends Plugin {
  settings: ObsidiClaudeSettings;

  async onload() {
    // Load settings
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    // Register the chat view
    this.registerView(
      CHAT_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new ChatView(leaf, this)
    );

    // Add ribbon icon
    this.addRibbonIcon('message-circle', 'Open Claude Chat', () => {
      this.activateChatView();
    });

    // Add command
    this.addCommand({
      id: 'open-chat',
      name: 'Open Claude Chat',
      callback: () => this.activateChatView(),
    });

    // Add settings tab
    this.addSettingTab(new SettingsTab(this.app, this));
  }

  async activateChatView() {
    const { workspace } = this.app;

    // Check if view already exists
    const leaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (leaves.length > 0) {
      workspace.revealLeaf(leaves[0]);
      return;
    }

    // Create new view in right sidebar
    const leaf = workspace.getRightLeaf(false);
    await leaf?.setViewState({
      type: CHAT_VIEW_TYPE,
      active: true,
    });
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

### ChatView (Sidebar)

```typescript
import { ItemView, WorkspaceLeaf, MarkdownRenderer, Component } from 'obsidian';
import ObsidiClaudePlugin from '../main';
import { ChatMessage } from './types';

export const CHAT_VIEW_TYPE = 'obsidi-claude-chat';

export class ChatView extends ItemView {
  plugin: ObsidiClaudePlugin;
  messages: ChatMessage[] = [];
  messagesContainer: HTMLElement;
  inputEl: HTMLTextAreaElement;
  private streamingMessage: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidiClaudePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Claude Chat';
  }

  getIcon(): string {
    return 'message-circle';
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('obsidi-claude-container');

    // Load previous messages
    await this.loadMessages();

    // Messages area
    this.messagesContainer = container.createDiv('chat-messages');
    this.renderAllMessages();

    // Input area
    const inputArea = container.createDiv('chat-input-area');
    this.inputEl = inputArea.createEl('textarea', {
      cls: 'chat-input',
      attr: {
        placeholder: 'Ask Claude anything...',
        rows: '3'
      },
    });

    // Send on Enter (Shift+Enter for newline)
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    const buttonArea = inputArea.createDiv('chat-buttons');

    const sendBtn = buttonArea.createEl('button', {
      cls: 'chat-send-btn mod-cta',
      text: 'Send',
    });
    sendBtn.onclick = () => this.sendMessage();

    const clearBtn = buttonArea.createEl('button', {
      cls: 'chat-clear-btn',
      text: 'Clear',
    });
    clearBtn.onclick = () => this.clearMessages();
  }

  private renderAllMessages() {
    this.messagesContainer.empty();
    for (const msg of this.messages) {
      this.renderMessage(msg);
    }
    this.scrollToBottom();
  }

  private renderMessage(msg: ChatMessage): HTMLElement {
    const msgDiv = this.messagesContainer.createDiv('chat-message');
    msgDiv.addClass(msg.role === 'user' ? 'user-message' : 'assistant-message');

    const roleLabel = msgDiv.createDiv('message-role');
    roleLabel.setText(msg.role === 'user' ? 'You' : 'Claude');

    const contentDiv = msgDiv.createDiv('message-content');

    // Render markdown
    MarkdownRenderer.render(
      this.plugin.app,
      msg.content,
      contentDiv,
      '',
      new Component()
    );

    return msgDiv;
  }

  private async sendMessage() {
    const content = this.inputEl.value.trim();
    if (!content) return;

    // Clear input
    this.inputEl.value = '';

    // Add user message
    const userMsg: ChatMessage = { role: 'user', content };
    this.messages.push(userMsg);
    this.renderMessage(userMsg);

    // Create placeholder for streaming response
    this.streamingMessage = this.messagesContainer.createDiv('chat-message assistant-message');
    const roleLabel = this.streamingMessage.createDiv('message-role');
    roleLabel.setText('Claude');
    const contentDiv = this.streamingMessage.createDiv('message-content');
    contentDiv.setText('Thinking...');

    try {
      // Stream response
      const response = await this.streamClaudeResponse(content, contentDiv);

      // Add to messages
      const assistantMsg: ChatMessage = { role: 'assistant', content: response };
      this.messages.push(assistantMsg);

      // Save
      await this.saveMessages();
    } catch (error) {
      contentDiv.setText(`Error: ${error.message}`);
      contentDiv.addClass('error-message');
    }

    this.streamingMessage = null;
    this.scrollToBottom();
  }

  private async streamClaudeResponse(userMessage: string, contentDiv: HTMLElement): Promise<string> {
    const apiKey = this.plugin.settings.apiKey;
    if (!apiKey) {
      throw new Error('API key not configured. Go to Settings > Obsidi-Claude');
    }

    // Build messages array for API
    const apiMessages = this.messages.map(m => ({
      role: m.role,
      content: m.content
    }));
    apiMessages.push({ role: 'user', content: userMessage });

    // Use fetch for streaming (requestUrl doesn't support streaming)
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.plugin.settings.model || 'claude-sonnet-4-20250514',
        max_tokens: this.plugin.settings.maxTokens || 4096,
        stream: true,
        system: this.plugin.settings.systemPrompt || 'You are a helpful AI assistant integrated into Obsidian.',
        messages: apiMessages,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API request failed');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');

      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'content_block_delta' && data.delta?.text) {
              fullContent += data.delta.text;

              // Update UI with streaming content
              contentDiv.empty();
              MarkdownRenderer.render(
                this.plugin.app,
                fullContent,
                contentDiv,
                '',
                new Component()
              );
              this.scrollToBottom();
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }

      buffer = lines[lines.length - 1];
    }

    return fullContent;
  }

  private scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  private async loadMessages() {
    const data = await this.plugin.loadData();
    this.messages = data?.messages || [];
  }

  private async saveMessages() {
    const currentData = await this.plugin.loadData() || {};
    await this.plugin.saveData({
      ...currentData,
      messages: this.messages,
    });
  }

  private async clearMessages() {
    this.messages = [];
    this.renderAllMessages();
    await this.saveMessages();
  }

  async onClose() {
    // Cleanup handled automatically
  }
}
```

### Settings Tab

```typescript
import { App, PluginSettingTab, Setting } from 'obsidian';
import ObsidiClaudePlugin from '../main';

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

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('Your Anthropic API key')
      .addText(text => text
        .setPlaceholder('sk-ant-...')
        .setValue(this.plugin.settings.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.apiKey = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Model')
      .setDesc('Claude model to use')
      .addDropdown(dropdown => dropdown
        .addOption('claude-sonnet-4-20250514', 'Claude Sonnet 4')
        .addOption('claude-opus-4-20250514', 'Claude Opus 4')
        .addOption('claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet')
        .setValue(this.plugin.settings.model)
        .onChange(async (value) => {
          this.plugin.settings.model = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Max Tokens')
      .setDesc('Maximum tokens in response')
      .addSlider(slider => slider
        .setLimits(256, 8192, 256)
        .setValue(this.plugin.settings.maxTokens)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxTokens = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('System Prompt')
      .setDesc('Custom instructions for Claude')
      .addTextArea(text => text
        .setPlaceholder('You are a helpful AI assistant...')
        .setValue(this.plugin.settings.systemPrompt)
        .onChange(async (value) => {
          this.plugin.settings.systemPrompt = value;
          await this.plugin.saveSettings();
        }));
  }
}
```

### Types

```typescript
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

export interface ObsidiClaudeSettings {
  apiKey: string;
  model: string;
  maxTokens: number;
  systemPrompt: string;
}

export const DEFAULT_SETTINGS: ObsidiClaudeSettings = {
  apiKey: '',
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096,
  systemPrompt: 'You are a helpful AI assistant integrated into Obsidian. Help the user with their notes, writing, and knowledge management.',
};
```

### CSS Styles

```css
.obsidi-claude-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.chat-message {
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  max-width: 90%;
}

.user-message {
  background-color: var(--interactive-accent);
  color: var(--text-on-accent);
  align-self: flex-end;
}

.assistant-message {
  background-color: var(--background-secondary);
  align-self: flex-start;
}

.message-role {
  font-size: 0.75rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
  opacity: 0.8;
}

.message-content {
  line-height: 1.5;
}

.message-content p:last-child {
  margin-bottom: 0;
}

.message-content pre {
  margin: 0.5rem 0;
  padding: 0.5rem;
  border-radius: 0.25rem;
  background-color: var(--background-primary);
  overflow-x: auto;
}

.chat-input-area {
  padding: 1rem;
  border-top: 1px solid var(--background-modifier-border);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.chat-input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--background-modifier-border);
  border-radius: 0.25rem;
  font-family: inherit;
  resize: vertical;
  min-height: 60px;
}

.chat-buttons {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.chat-send-btn {
  padding: 0.5rem 1rem;
}

.chat-clear-btn {
  padding: 0.5rem 1rem;
}

.error-message {
  color: var(--text-error);
}
```

---

## Claude Integration Options

### Option 1: Anthropic REST API (Recommended)

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: settings.apiKey,
});

// Non-streaming
const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 4096,
  messages: [{ role: 'user', content: 'Hello!' }],
});

// Streaming
const stream = await client.messages.stream({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 4096,
  messages: [{ role: 'user', content: 'Hello!' }],
});

for await (const event of stream) {
  if (event.type === 'content_block_delta') {
    process.stdout.write(event.delta.text);
  }
}
```

### Option 2: Claude Agent SDK (Advanced)

Requires separate backend or subprocess:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const response = query({
  prompt: 'Analyze this codebase',
  options: {
    model: 'claude-sonnet-4-5',
    allowedTools: ['Read', 'Grep', 'Glob'],
    workingDirectory: '/path/to/project',
  }
});

for await (const message of response) {
  if (message.type === 'assistant') {
    console.log(message.content);
  }
  if (message.type === 'system' && message.subtype === 'init') {
    console.log(`Session: ${message.session_id}`);
  }
}
```

**Key Agent SDK Features:**
- Session management with resume/fork
- Built-in tools: Read, Write, Edit, Bash, Grep, Glob, WebFetch, WebSearch
- Custom MCP tools
- Permission control via `canUseTool` callback
- Cost tracking

---

## Happy Coder Patterns

### Architecture Overview

```
happy-cli ◄──► happy-server ◄──► happy (mobile/web)
   │              │                    │
   └─ Claude Code └─ Encrypted relay   └─ React Native/Expo
```

### Key Patterns to Adopt

#### 1. End-to-End Encryption

```typescript
// Uses TweetNaCl.js (same as Signal, audited by Cure53)
import nacl from 'tweetnacl';

// Key exchange via QR code
const keyPair = nacl.box.keyPair();
const sharedSecret = nacl.box.before(peerPublicKey, keyPair.secretKey);

// Encrypt message
function encrypt(message: string, sharedSecret: Uint8Array): Uint8Array {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageBytes = new TextEncoder().encode(message);
  const encrypted = nacl.box.after(messageBytes, nonce, sharedSecret);
  return new Uint8Array([...nonce, ...encrypted]);
}
```

#### 2. Permission System

```typescript
interface PermissionRequest {
  id: string;
  tool: string;
  operation: 'read' | 'write' | 'execute';
  path?: string;
  command?: string;
  timestamp: number;
}

interface PermissionResponse {
  id: string;
  approved: boolean;
  modifiedInput?: any;
}

// Show permission UI before sensitive operations
async function requestPermission(req: PermissionRequest): Promise<PermissionResponse> {
  // Display modal with operation details
  // Wait for user decision
  // Return response
}
```

#### 3. Real-Time Streaming

```typescript
// WebSocket connection for live updates
const ws = new WebSocket('wss://relay.server.com');

ws.onmessage = (event) => {
  const encrypted = new Uint8Array(event.data);
  const decrypted = decrypt(encrypted, sharedSecret);
  const message = JSON.parse(decrypted);

  switch (message.type) {
    case 'terminal_output':
      appendToChat(message.content);
      break;
    case 'permission_request':
      showPermissionModal(message);
      break;
    case 'task_complete':
      notifyUser(message);
      break;
  }
};
```

#### 4. Session State Management

```typescript
interface Session {
  id: string;
  messages: ChatMessage[];
  toolCalls: ToolCall[];
  pendingPermissions: PermissionRequest[];
  metadata: {
    startedAt: number;
    lastActivity: number;
    totalCost: number;
  };
}

// Persist session for resume
async function saveSession(session: Session) {
  await this.plugin.saveData({ session });
}

// Resume previous session
async function resumeSession(sessionId: string) {
  const data = await this.plugin.loadData();
  return data.session;
}
```

---

## Recommended Implementation Plan

### Phase 1: MVP (Week 1-2)

1. **Basic Plugin Structure**
   - manifest.json, main.ts, types.ts
   - Build configuration (esbuild)

2. **Chat View**
   - ItemView sidebar
   - Message rendering with markdown
   - Basic input handling

3. **Claude REST API Integration**
   - API client with streaming
   - Error handling
   - Settings for API key

4. **Persistence**
   - Message history via `saveData()`
   - Settings tab

### Phase 2: Enhanced Features (Week 3-4)

1. **Vault Integration**
   - Reference current note in conversation
   - Insert Claude responses into notes
   - @ mention files

2. **Conversation Management**
   - Multiple conversations
   - Export conversations
   - Search history

3. **UI Polish**
   - Streaming animation
   - Code syntax highlighting
   - Copy buttons

### Phase 3: Advanced (Week 5+)

1. **Tool Integration**
   - Custom tools for vault operations
   - Note creation/editing via Claude

2. **Optional: Agent SDK Backend**
   - Separate server component
   - Full file/shell access
   - Session resumption

3. **Optional: Happy Coder Integration**
   - Mobile companion app
   - End-to-end encryption
   - Cross-device sync

---

## Resources

### Official Documentation

- [Obsidian Developer Docs](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [Obsidian API Reference](https://docs.obsidian.md/Reference/TypeScript+API)
- [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk)

### Example Plugins

- [Smart Chat Obsidian](https://github.com/brianpetro/smart-chat-obsidian) - AI chat implementation
- [Obsidian Chat View](https://github.com/adifyr/obsidian-chat-view) - Chat UI patterns
- [Text Generator](https://github.com/nhaouari/obsidian-textgenerator-plugin) - AI integration

### Happy Coder

- [Main Repo](https://github.com/slopus/happy) - Mobile/web client
- [CLI](https://github.com/slopus/happy-cli) - Command-line tool
- [Server](https://github.com/slopus/happy-server) - Relay backend
- [Docs](https://happy.engineering/docs/features/) - Feature documentation

### Libraries

- [@anthropic-ai/sdk](https://www.npmjs.com/package/@anthropic-ai/sdk) - Official Anthropic SDK
- [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) - Agent SDK
- [tweetnacl](https://www.npmjs.com/package/tweetnacl) - Encryption (Signal-grade)
