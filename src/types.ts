/**
 * User reaction to a message (thumbs up/down for feedback collection)
 */
export type MessageReaction = 'up' | 'down' | null;

/**
 * Token usage for a single message
 */
export interface MessageUsage {
  inputTokens: number;
  outputTokens: number;
  /** Estimated cost in USD (based on model pricing) */
  cost?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
  isStreaming?: boolean;
  /** User feedback reaction */
  reaction?: MessageReaction;
  /** Whether this message is bookmarked/starred */
  bookmarked?: boolean;
  /** Token usage for this message (assistant messages only) */
  usage?: MessageUsage;
  /** SDK message UUID for file checkpointing/rewind (SDK backend only) */
  sdkUuid?: string;
}

export interface ToolCallInfo {
  name: string;
  input: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
}

/**
 * Metadata for cross-platform conversation continuity
 */
export interface ConversationMetadata {
  /** Which backend created/last used this conversation */
  backendType: 'sdk' | 'api';
  /** SDK session ID (desktop only, enables resume) */
  sessionId?: string;
  /** Timestamp of last sync (for Obsidian Sync) */
  lastSyncAt?: number;
}

/**
 * Aggregated usage statistics for a conversation
 */
export interface ConversationUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  messageCount: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  /** @deprecated Use metadata.sessionId instead */
  sessionId?: string;
  metadata?: ConversationMetadata;
  createdAt: number;
  updatedAt: number;
  /** User-defined tags for organization */
  tags?: string[];
  /** Pinned conversations appear at top of history */
  pinned?: boolean;
  /** Aggregated usage statistics */
  usage?: ConversationUsage;
}

export type EmbeddingProviderType =
  | 'transformers'
  | 'ollama'
  | 'openai'
  | 'voyage';

export interface EmbeddingSettings {
  enabled: boolean;
  provider: EmbeddingProviderType;
  // Local options
  localModel?: string;
  ollamaHost?: string;
  // OpenAI options
  openaiApiKey?: string;
  openaiModel?: string;
  openaiDimensions?: number;
  // Voyage options
  voyageApiKey?: string;
  voyageModel?: string;
  // Indexing options
  autoIndex: boolean;
  chunkSize: number;
  chunkOverlap: number;
  excludeFolders: string[];
  // Performance options
  batchSize?: number;        // Files to process before yielding (default: 10)
  batchDelayMs?: number;     // Delay between batches in ms (default: 100)
}

export interface MCPSettings {
  enabled: boolean;
  serverName: string;
  transport: 'stdio' | 'http' | 'sse' | 'both';
  httpPort: number;
}

export interface ExternalMCPServer {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export interface SkillSettings {
  enabled: boolean;
  /** Folder path within vault for skills (e.g., ".claude/skills") */
  folderPath: string;
  /** Install bundled skills (e.g., kepano's obsidian-markdown) */
  installBundledSkills: boolean;
}

/**
 * Parsed skill from a SKILL.md file.
 * Skills are markdown files with YAML frontmatter that define context
 * to inject into Claude's system prompt.
 */
export interface Skill {
  /** Unique skill identifier (from frontmatter or filename) */
  name: string;
  /** Human-readable description */
  description: string;
  /** File path within vault */
  path: string;
  /** Keywords/patterns that trigger this skill */
  triggers: string[];
  /** Tool names this skill is relevant for */
  tools?: string[];
  /** The skill content (instructions to inject) */
  content: string;
  /** Whether this skill is always active */
  alwaysActive?: boolean;
}

export const DEFAULT_SKILL_SETTINGS: SkillSettings = {
  enabled: true,
  folderPath: '.claude/skills',
  installBundledSkills: true,
};

/**
 * Custom subagent definition (mirrors SDK AgentDefinition)
 */
export interface CustomAgent {
  /** Unique identifier for the agent */
  name: string;
  /** Natural language description of when to use this agent */
  description: string;
  /** The agent's system prompt */
  prompt: string;
  /** Model to use (inherit = use main model) */
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
  /** Array of allowed tool names (empty = inherit all) */
  tools?: string[];
  /** Array of tool names to explicitly disallow */
  disallowedTools?: string[];
  /** Maximum agentic turns before stopping */
  maxTurns?: number;
  /** Whether this agent is enabled */
  enabled: boolean;
}

export interface AgentSettings {
  /** Enable custom agents feature */
  enabled: boolean;
  /** Use built-in Obsidian agents (research, writer, organizer) */
  useBuiltinAgents: boolean;
  /** Custom user-defined agents */
  customAgents: CustomAgent[];
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  enabled: true,
  useBuiltinAgents: true,
  customAgents: [],
};

/**
 * Built-in agents optimized for Obsidian knowledge work
 */
export const BUILTIN_AGENTS: Record<string, Omit<CustomAgent, 'enabled'>> = {
  research: {
    name: 'research',
    description: 'Research agent for finding, reading, and synthesizing information from notes. Use when you need to gather information across multiple notes or explore a topic in depth.',
    prompt: `You are a research assistant focused on the user's Obsidian vault.

Your goal is to find relevant information by:
1. Using semantic_search to find notes by meaning
2. Using search_content for keyword-based searches
3. Reading and synthesizing information from multiple notes
4. Following links to discover connected knowledge

Always cite your sources with [[note names]]. Summarize findings clearly and indicate confidence levels.`,
    model: 'haiku',
    tools: ['semantic_search', 'search_content', 'read_note', 'file_metadata', 'backlinks', 'outgoing_links', 'graph_neighbors'],
    maxTurns: 15,
  },
  writer: {
    name: 'writer',
    description: 'Writing agent for creating well-structured notes with proper formatting, frontmatter, and links. Use when creating new content or significantly expanding existing notes.',
    prompt: `You are a writing assistant for Obsidian notes.

Your goal is to create high-quality notes by:
1. Using proper markdown formatting
2. Adding appropriate frontmatter (tags, aliases, dates)
3. Creating links to related notes using [[wikilinks]]
4. Following the user's existing note conventions

Before creating a note, search to avoid duplicates. Structure content with clear headings and maintain consistent style.`,
    model: 'inherit',
    tools: ['create_note', 'append_to_note', 'search_content', 'semantic_search', 'vault_structure', 'vault_tags'],
    maxTurns: 10,
  },
  organizer: {
    name: 'organizer',
    description: 'Organization agent for tagging, linking, and restructuring notes. Use when you need to improve note organization, add missing links, or clean up tags.',
    prompt: `You are an organization assistant for Obsidian vaults.

Your goal is to improve vault organization by:
1. Adding appropriate tags based on content
2. Creating bidirectional links between related notes
3. Identifying orphaned notes that need connections
4. Suggesting folder reorganization

Analyze existing patterns before making changes. Preserve the user's organizational style while improving discoverability.`,
    model: 'haiku',
    tools: ['vault_tags', 'search_by_property', 'backlinks', 'outgoing_links', 'append_to_note', 'file_metadata', 'vault_structure'],
    maxTurns: 20,
  },
};

export interface ObsidiClaudeSettings {
  model: 'claude-sonnet-4-5' | 'claude-opus-4' | 'claude-3-5-sonnet-20241022';
  systemPrompt: string;
  maxTurns: number;
  workingDirectory: string;
  claudeCodePath: string;
  allowedTools: string[];
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions';
  showToolCalls: boolean;
  streamResponses: boolean;
  embedding: EmbeddingSettings;
  mcp: MCPSettings;
  externalMcpServers: ExternalMCPServer[];
  /** Anthropic API key for direct API backend (mobile) - overrides env var */
  anthropicApiKey: string;
  /** Preferred backend when both are available */
  preferredBackend: 'auto' | 'sdk' | 'api';
  /** Skills configuration */
  skills: SkillSettings;
  /** Custom agents configuration */
  agents: AgentSettings;
  /** Automatically include active note as context */
  activeNoteContext: boolean;

  // SDK-specific advanced settings
  /** Maximum budget in USD per conversation (SDK only) */
  maxBudgetUsd?: number;
  /** Enable file checkpointing for undo/rewind (SDK only) */
  enableFileCheckpointing: boolean;
  /** Enable 1M token context window for large vaults (SDK only, Sonnet 4/4.5) */
  extendedContext: boolean;
  /** Maximum thinking tokens to control costs (SDK only) */
  maxThinkingTokens?: number;
  /** Additional directories Claude can access beyond working directory */
  additionalDirectories: string[];
  /** System prompt mode: 'replace' replaces Claude Code default, 'append' adds to it */
  systemPromptMode: 'replace' | 'append';
  /** Auto-continue most recent session in working directory */
  continueSession: boolean;
  /** Tools to block entirely (removed from model context) */
  disallowedTools: string[];
  /** Load project CLAUDE.md from vault (requires .claude/CLAUDE.md in working directory) */
  loadVaultClaudeMd: boolean;
  /** Agent name to use for main conversation thread (must be defined in agents) */
  mainAgent?: string;
}

/**
 * Maps friendly model names to full Anthropic API model IDs.
 *
 * The keys correspond to the model union type in ObsidiClaudeSettings.
 * The values are the actual model IDs expected by the Anthropic API.
 */
export const MODEL_ID_MAP: Record<ObsidiClaudeSettings['model'], string> = {
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250514',
  'claude-opus-4': 'claude-opus-4-20250514',
  'claude-3-5-sonnet-20241022': 'claude-3-5-sonnet-20241022',
};

export const DEFAULT_EMBEDDING_SETTINGS: EmbeddingSettings = {
  enabled: false,
  provider: 'ollama',
  localModel: 'nomic-embed-text',
  ollamaHost: 'http://localhost:11434',
  openaiModel: 'text-embedding-3-small',
  openaiDimensions: 512,
  voyageModel: 'voyage-3-large',
  autoIndex: true,
  chunkSize: 512,
  chunkOverlap: 50,
  excludeFolders: ['.obsidian', '.trash', 'node_modules'],
  batchSize: 10,
  batchDelayMs: 100,
};

export const DEFAULT_MCP_SETTINGS: MCPSettings = {
  enabled: false,
  serverName: 'obsidi-claude',
  transport: 'http',
  httpPort: 3000,
};

export const DEFAULT_SETTINGS: ObsidiClaudeSettings = {
  model: 'claude-sonnet-4-5',
  systemPrompt: `You are Claude, an AI assistant deeply integrated with Obsidian. You have direct access to the user's knowledge base and can read, write, search, and navigate their vault.

## Core Capabilities

**Knowledge Discovery**
- \`semantic_search\` - Find relevant notes by meaning, not just keywords
- \`search_content\` - Full-text search across all notes
- \`search_by_property\` - Query notes by frontmatter properties
- \`vault_tags\` - Explore the tag taxonomy

**Note Operations**
- \`create_note\` - Create new notes with proper frontmatter
- \`append_to_note\` - Add content to existing notes
- \`set_frontmatter\` - Update YAML frontmatter properties
- \`rename_note\` - Rename and refactor notes
- \`daily_note\` - Access or create daily notes
- \`list_templates\` / \`create_from_template\` - Work with templates
- \`create_canvas\` - Create visual canvases with nodes and edges

**Navigation & Context**
- \`active_note\` - See what the user is currently viewing
- \`open_note\` - Open notes in the Obsidian editor
- \`file_metadata\` - Get frontmatter, dates, and stats
- \`recent_files\` - Find recently modified notes

**Graph & Links**
- \`backlinks\` - Find all notes linking to a given note
- \`outgoing_links\` - See what a note links to
- \`graph_neighbors\` - Discover related notes via the knowledge graph
- \`vault_structure\` - Understand folder organization

## Obsidian Markdown Syntax

**Internal Links (Wikilinks)**
- Basic: \`[[Note Name]]\` or \`[[Note Name|Display Text]]\`
- To heading: \`[[Note#Heading]]\`
- To block: \`[[Note#^block-id]]\`

**Embeds** - Prefix with \`!\` to embed content inline:
- \`![[Note]]\` - Embed entire note
- \`![[image.png]]\` or \`![[image.png|300]]\` - Embed with optional width
- \`![[Note#Heading]]\` - Embed specific section

**Callouts** - Use \`> [!type]\` syntax:
\`\`\`
> [!note] Title
> Content here
\`\`\`
Types: note, tip, warning, danger, info, todo, example, quote, abstract, success, question, failure, bug

**Properties (Frontmatter)** - YAML at document start:
\`\`\`yaml
---
title: Note Title
tags: [tag1, tag2]
aliases: [alias1]
date: 2025-01-15
status: draft
---
\`\`\`

**Tags** - Use \`#tag\` inline or in frontmatter. Nested: \`#parent/child\`

**Task Lists**
- \`- [ ] \` Incomplete task
- \`- [x] \` Completed task

**Comments** - Hidden from preview: \`%% comment text %%\`

## Guidelines

1. **Search before creating** - Check if relevant notes exist before making new ones
2. **Preserve structure** - Follow the user's existing folder and naming conventions
3. **Use frontmatter** - Add appropriate metadata (tags, aliases, dates) to new notes
4. **Link liberally** - Connect new content to existing notes with [[wikilinks]]
5. **Use Obsidian syntax** - Prefer wikilinks, callouts, and embeds over raw markdown

When the user asks about their notes, always search first to ground your response in their actual content.`,
  maxTurns: 50,
  workingDirectory: '',
  claudeCodePath: '',
  allowedTools: [
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
    'Bash',
    'WebFetch',
    'WebSearch',
  ],
  permissionMode: 'default',
  showToolCalls: true,
  streamResponses: true,
  embedding: DEFAULT_EMBEDDING_SETTINGS,
  mcp: DEFAULT_MCP_SETTINGS,
  externalMcpServers: [],
  anthropicApiKey: '',
  preferredBackend: 'auto',
  skills: DEFAULT_SKILL_SETTINGS,
  agents: DEFAULT_AGENT_SETTINGS,
  activeNoteContext: true,
  // SDK advanced settings
  maxBudgetUsd: undefined, // No limit by default
  enableFileCheckpointing: true, // Enable undo/rewind by default
  extendedContext: false, // Opt-in for 1M context
  maxThinkingTokens: undefined, // No limit by default
  additionalDirectories: [], // Vault path added dynamically
  systemPromptMode: 'append', // Append to Claude Code's default prompt
  continueSession: false, // Don't auto-continue by default
  disallowedTools: [], // No tools blocked by default
  loadVaultClaudeMd: false, // Don't load vault CLAUDE.md by default
  mainAgent: undefined, // No main agent by default (use normal conversation)
};

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Pricing per 1M tokens in USD (as of 2025)
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-opus-4': { input: 15.0, output: 75.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  // Fallback for unknown models
  'default': { input: 3.0, output: 15.0 },
};

/**
 * Calculate cost in USD for token usage
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['default'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Calculate total usage for a conversation
 */
export function calculateConversationUsage(messages: ChatMessage[]): ConversationUsage {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  let messageCount = 0;

  for (const msg of messages) {
    if (msg.usage) {
      totalInputTokens += msg.usage.inputTokens;
      totalOutputTokens += msg.usage.outputTokens;
      totalCost += msg.usage.cost ?? 0;
      messageCount++;
    }
  }

  return { totalInputTokens, totalOutputTokens, totalCost, messageCount };
}
