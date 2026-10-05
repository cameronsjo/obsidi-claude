---
name: obsidi-claude
description: "Get started with obsidi-claude — what it is, how to set it up, and how to use it"
---


Guide the user through getting started with **obsidi-claude**.

## About

obsidi-claude is an Obsidian plugin that lets you chat with Claude AI directly inside Obsidian, using the official Agent SDK. Claude can read/write files, run commands, search the web, and use tools -- all from within a chat panel in your vault. Supports both SDK mode (full Claude Code features, desktop only) and API mode (direct Anthropic API, all platforms).

## Prerequisites

Check that the user has the following installed/configured:

- Node.js 18+
- npm (for dependency installation)
- Obsidian Desktop (not mobile -- the SDK backend requires Node.js features)
- Claude Code CLI installed and authenticated (`claude --version` to verify, `claude login` if needed)
- An Obsidian vault to link the plugin into

## Setup

Walk the user through initial setup:

1. Clone the repo and install dependencies:
   ```bash
   git clone <repo-url>
   cd obsidi-claude
   npm install
   ```
2. Build the plugin:
   ```bash
   npm run build
   ```
3. Symlink into your Obsidian vault's plugins directory:
   ```bash
   ln -sfn /path/to/obsidi-claude /path/to/vault/.obsidian/plugins/obsidi-claude
   ```
4. In Obsidian, go to Settings > Community Plugins > enable "Obsidi-Claude"

For development with auto-rebuild on changes:
```bash
npm run dev
```

## First Use

Guide the user through their first interaction with the product:

1. In Obsidian, click the message icon in the ribbon (or run the "Open Claude Chat" command via Cmd+P).
2. Type a message and press Enter.
3. Claude will respond with streaming output. If tools are enabled, you'll see tool usage indicators.
4. Configure behavior in Settings > Obsidi-Claude (model selection, permission mode, working directory, allowed tools).

## Key Files

Point the user to the most important files for understanding the project:

- `main.ts` - Plugin entry point, registers views and commands
- `src/chatView.ts` - Main chat UI view implementation
- `src/backends/` - SDK and API backend implementations
- `src/settingsTab.ts` - Plugin settings configuration UI
- `src/types.ts` - Shared TypeScript type definitions
- `manifest.json` - Obsidian plugin manifest (id, version, min app version)
- `package.json` - Dependencies and build scripts
- `esbuild.config.mjs` - Build configuration

## Common Tasks

- **Build for production:**
  ```bash
  npm run build
  ```
- **Dev mode (auto-rebuild):**
  ```bash
  npm run dev
  ```
- **Run tests:**
  ```bash
  npm test
  ```
- **Run tests with coverage:**
  ```bash
  npm run test:coverage
  ```
- **Update version numbers:**
  ```bash
  npm run version
  ```
