# Vault-Based Conversation Storage

**Date:** 2026-01-31
**Status:** Approved
**Issue:** obsidi-claude-zj7

## Problem

Conversations are stored in `.obsidian/plugins/obsidi-claude/conversations/` - hidden from the vault, not synced via Obsidian Sync, preventing cross-device conversation continuity.

## Solution

Opt-in vault-based storage that saves conversations as JSON files within the vault, enabling Obsidian Sync to sync them across devices.

## Design

### Settings

```typescript
interface ConversationStorageSettings {
  enabled: boolean;        // Store in vault (default: false)
  folderPath: string;      // Vault folder (default: '.claude/conversations')
  autoResume: boolean;     // Resume last conversation on startup (default: false)
}
```

### File Structure

```
{folderPath}/
├── index.json      # Conversation metadata list
├── {id}.json       # Individual conversations
└── current.json    # Active conversation pointer
```

### Behavior

1. **When enabled:** StorageService uses `app.vault.adapter` for file I/O
2. **When disabled:** Current behavior (plugin storage)
3. **Migration:** One-time migration when enabled, vault becomes single source of truth

### Implementation

1. Add `ConversationStorageSettings` to `types.ts`
2. Update `StorageService` to conditionally use vault adapter
3. Add migration logic in settings toggle handler
4. Add UI section in settings tab

## Non-Goals

- Markdown export (may add later as separate feature)
- Conflict resolution (Obsidian Sync handles this)
