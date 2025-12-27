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

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  sessionId?: string;
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
}

export interface MCPSettings {
  enabled: boolean;
  serverName: string;
}

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
}

export const DEFAULT_EMBEDDING_SETTINGS: EmbeddingSettings = {
  enabled: false,
  provider: 'transformers',
  localModel: 'Xenova/all-MiniLM-L6-v2',
  ollamaHost: 'http://localhost:11434',
  openaiModel: 'text-embedding-3-small',
  openaiDimensions: 512,
  voyageModel: 'voyage-3-large',
  autoIndex: true,
  chunkSize: 512,
  chunkOverlap: 50,
  excludeFolders: ['.obsidian', '.trash', 'node_modules'],
};

export const DEFAULT_MCP_SETTINGS: MCPSettings = {
  enabled: false,
  serverName: 'obsidi-claude',
};

export const DEFAULT_SETTINGS: ObsidiClaudeSettings = {
  model: 'claude-sonnet-4-5',
  systemPrompt: `You are an AI assistant integrated into Obsidian, a knowledge management application.

You have access to the user's vault (notes directory) and can help with:
- Answering questions about their notes
- Writing and editing content
- Analyzing and organizing information
- Running commands and scripts when needed

Use the semantic_search tool to find relevant notes based on meaning, not just keywords.
Be concise but thorough. Use markdown formatting in your responses.`,
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
};

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
