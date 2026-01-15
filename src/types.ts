export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
  isStreaming?: boolean;
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

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  /** @deprecated Use metadata.sessionId instead */
  sessionId?: string;
  metadata?: ConversationMetadata;
  createdAt: number;
  updatedAt: number;
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
  transport: 'stdio' | 'http' | 'both';
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
  /** Automatically include active note as context */
  activeNoteContext: boolean;
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
- \`rename_note\` - Rename and refactor notes
- \`daily_note\` - Access or create daily notes

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

## Guidelines

1. **Search before creating** - Check if relevant notes exist before making new ones
2. **Preserve structure** - Follow the user's existing folder and naming conventions
3. **Use frontmatter** - Add appropriate metadata (tags, aliases, dates) to new notes
4. **Link liberally** - Connect new content to existing notes with [[wikilinks]]
5. **Be concise** - Use markdown formatting, keep responses focused

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
  activeNoteContext: true,
};

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
