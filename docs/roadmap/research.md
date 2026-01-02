# UX Research: Claude Code Parity

## What Makes Claude Code Feel Great

### 1. **Real-time Transparency**
- You always know exactly what's happening
- Tool usage shown inline with the response, not aggregated
- Progress feels tangible - not just "thinking..."

### 2. **Tool Calls as First-Class Citizens**
Claude Code shows:
```
⏺ Read src/index.ts
  → 245 lines
⏺ Edit src/index.ts
  → +12 -3 lines
⏺ Bash npm test
  → 12 tests passed
```

Not just "Used tool: Read" buried somewhere.

### 3. **Streaming That Breathes**
- Text appears word-by-word, feels alive
- Tool calls interrupt naturally, then response continues
- Paragraph breaks feel intentional

### 4. **Keyboard-First Power**
- `/` commands for quick actions
- `Ctrl+C` to abort
- Arrow keys for history
- Tab completion

### 5. **Context is King**
- Session continuity (pick up where you left off)
- File context injection (current file, selection)
- Project awareness (knows your codebase)

### 6. **Progressive Disclosure**
- Collapsed tool details by default
- Expand to see full input/output
- Error details on demand

---

## Gap Analysis: Current Plugin vs Claude Code

| Feature | Claude Code | Current Plugin | Priority |
|---------|-------------|----------------|----------|
| Inline tool display | ✅ Each tool shown as it happens | ❌ Aggregated at bottom | P0 |
| Tool detail expansion | ✅ Click to expand | ❌ Truncated only | P1 |
| Streaming word-by-word | ✅ Natural flow | ⚠️ Chunk-based | P2 |
| Paragraph separation | ✅ Clean breaks | ❌ Concatenated | P0 |
| `/` slash commands | ✅ Full command palette | ❌ None | P1 |
| Current file context | ✅ Automatic | ❌ Manual only | P1 |
| Copy code blocks | ✅ One-click | ❌ Select + copy | P2 |
| Token/cost display | ✅ Always visible | ⚠️ Only at end | P2 |
| Abort with feedback | ✅ Clean stop | ⚠️ Abrupt | P2 |
| Input history | ✅ Arrow keys | ❌ None | P2 |
| Multi-turn awareness | ✅ Seamless | ✅ Via session | ✓ |

---

## Proposed Enhancements (Prioritized)

### P0: Critical UX Fixes
1. **Fix message aggregation** - Proper line breaks between messages
2. **Inline tool display** - Show each tool call where it happens in the stream
3. **Tool call timing** - Show tools as they execute, not after

### P1: Power User Features
4. **Expandable tool details** - Click tool to see full input/output
5. **Slash commands** - `/clear`, `/new`, `/search`, `/skills`
6. **Active note context** - Auto-inject current note as context
7. **Selection context** - Send selected text to Claude

### P2: Polish
8. **Copy button on code blocks** - One-click copy
9. **Token counter** - Running count in status bar
10. **Input history** - Up/down arrows cycle previous messages
11. **Typing indicator refinement** - Show "Reading file..." during tool use
12. **Smooth abort** - "Stopped by user" with partial response preserved

### P3: Delight
13. **Keyboard shortcuts overlay** - `?` shows all shortcuts
14. **Message actions menu** - Copy, regenerate, edit
15. **Conversation bookmarks** - Star important chats
16. **Export conversation** - Markdown/PDF export

---

## Implementation Notes

### Inline Tool Display
Current flow:
```
[Message starts streaming]
[All tools aggregate at bottom after completion]
```

Desired flow:
```
[Text streams...]
[Tool card appears inline: "Reading vault_structure..."]
[Tool completes, shows result preview]
[Text continues streaming...]
```

This requires:
- Tracking tool call position in stream
- Inserting tool UI elements mid-content
- Maintaining scroll position during insertions

### Slash Commands
Intercept input starting with `/`:
- `/clear` - Clear current conversation
- `/new` - New conversation
- `/search <query>` - Search messages
- `/note` - Insert current note content
- `/skills` - List active skills
- `/reload` - Reload skills

### Context Injection
On each message, optionally prepend:
```
[Context: Currently viewing "Project Ideas.md"]
[Selected text: "..."]
```

User setting to enable/disable auto-context.

---

## Questions to Resolve

1. **Tool display granularity** - Show every tool or group by type?
2. **Context injection UI** - Visible chips or hidden?
3. **Slash command discoverability** - Autocomplete dropdown?
4. **Mobile considerations** - Same UX or simplified?
