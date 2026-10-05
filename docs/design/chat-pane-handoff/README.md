# Handoff: Obsidian × Claude Code chat pane

## Overview
A chat interface for an **Obsidian plugin** that drives **local Claude Code via the Claude Agent SDK**. It covers the message thread, the full vocabulary of Claude Code tool calls (thinking, plan/todo, vault search, file reads, web fetch, file-edit diffs, terminal-command permission prompts), the composer, and two secondary views — **Chat history** and **Settings**. The whole thing is designed to look like a *native built-in Obsidian panel*, themed for both dark and light, and to work at both sidebar width (~380px) and main-tab width (~720px).

> Scope note: this design is the **chat & presentation layer only**. It does not implement the SDK transport, the agent loop, permission enforcement, or vault file I/O — it presents them. Wiring to the real Claude Agent SDK / Claude Code session is the implementation task.

## About the Design Files
The files in this bundle are **design references authored in HTML** (as "Design Components" — a small live-rendering wrapper). They are prototypes that show intended **look and behavior**, not production code to copy directly.

The task is to **recreate these designs in the target codebase** using its established environment and patterns. For an Obsidian plugin that means **TypeScript + the Obsidian Plugin API**, rendering into an `ItemView` (right-leaf or main workspace leaf). Use Obsidian's own CSS variables for theming rather than the hardcoded palette here (see *Design Tokens → mapping to Obsidian*). The HTML/inline-style structure is a faithful spec for layout, hierarchy, spacing, copy, and interaction — reproduce that fidelity with native DOM construction (`createEl`) or whatever rendering layer the plugin uses (e.g. a small Preact/React island).

## Fidelity
**High-fidelity.** Final colors, typography, spacing, iconography, copy, and interaction states are all intentional. Recreate pixel-faithfully — but substitute Obsidian theme variables for the literal hex values so it inherits the user's actual theme.

## How the prototype is organized
- **`ObsidianChatPane.dc.html`** — the entire pane. One component, three views switched by a `view` prop/state (`chat` | `history` | `settings`), themed by a `theme` prop (`dark` | `light`). All real logic lives here.
- **`Obsidian Claude Chat.dc.html`** — a presentation harness only. It mounts the pane eight times on a gray canvas (dark/light × sidebar/main, plus history and settings in both themes) so reviewers can see every state at once. **Not part of the product** — ignore for implementation except as a visual index.
- **`support.js`** — the prototype runtime. **Not part of the product**; do not port it.

---

## Views

### 1. Chat thread (`view: "chat"`)
The primary view. Vertical stack: fixed **header**, scrolling **message list**, fixed **composer**.

**Header** (height 42px, bottom border):
- Left: a 18px rounded-square app glyph in accent color, then **"Claude Code"** (600, 13px), then the active model in mono (`sonnet-4.5`, 11px, muted).
- Right: a **`+`** icon button (new chat) and a **`···`** icon button (overflow menu). Both 26px, 6px radius, hover = `bg3`.
- Icon buttons are 26×26 with centered SVG; hover background `--bg3`.

**Message list** (flex:1, scroll, padding 16px 14px 10px):

*User message* — small round avatar (17px) + "You" label (11.5px, 600, muted), then a bubble: `bg2` fill, 1px `bd` border, 10px radius, 9px/12px padding, 13.5px/1.55 text. Inline file mentions render as mono chips (`bg3`, 1px 5px padding, 4px radius).

*Assistant message* — square accent avatar (17px, 5px radius, white rotated diamond inside) + "Claude" label, then a sequence of blocks:

- **Thinking block** — a one-line toggle row: chevron + small filled accent circle icon + italic "Thought for 4s". Click expands an italic, muted, left-border-ruled paragraph (2px `bd` left border, 11px left padding). Collapsed by default.
- **Plan / todo card** — bordered card (`bg2`, 1px `bd`, 9px radius). Header row: chevron + list icon + "Plan" (600) + "· 3 of 4 done" (faint). Expanded by default. Body: checklist rows, 13px; done items use a green check + strikethrough muted text; pending item uses a hollow circle + normal text.
- **Tool-call card (search)** — same card chrome. One-line header: chevron + search icon + "Searched vault" + mono query chip (`"plain text"`, faint) + right-aligned "4 notes". Expands to a list of `filename.md` (mono, accent) + match-count (faint) rows. Collapsed by default.
- **Inline quiet tool line (file reads)** — NOT a card; a subtle indented row: doc icon + "Read 3 notes · `a.md, b.md, c.md`" in faint mono. This is the "inline & quiet" treatment for low-signal tools.
- **Markdown answer** — normal prose, 13.5px/1.6. Supports: paragraphs, an uppercase faint "WORKING TITLE" eyebrow, a large bold title line, bold section headings, bulleted lists, a blockquote (3px accent left border, italic, muted), and **fenced code** (`--bgc` fill, 1px `bd`, 7px radius, mono 11.5px, horizontal scroll, preserved whitespace).
- **Web-fetch card** — card chrome; header: chevron + globe icon + "Fetched" + mono accent domain (`git-scm.com`) + right "About". Expands to a muted summary paragraph. Collapsed by default.
- **File-edit diff card** — card chrome; header: chevron + green edit icon + mono filename + a green **"NEW"** badge (`--grnb` bg) + right-aligned `+12` (green) / `−0` (faint) stat. Expanded by default. Body (separated by top border): per-line diff rows — a 24px-wide centered green sign gutter (`+`/`−`) + mono line content, additions tinted with `--grnb` row background. (Use red `--redb` + `−` for deletions when present.)
- **Permission / approval prompt** — the most prominent block. Card with stronger border (`bd2`), 10px radius. Title row: yellow command-chevron icon + "Run a terminal command?" (600). A mono command box (`--bgc`, 1px `bd`, 7px radius) showing `$ git add "Blog Outline.md" && git commit -m "..."` with the `$` faint and quoted strings green. Then a button row: **Allow once** (filled accent, white), **Always** (`bg3` fill, bordered), spacer, **Deny** (transparent, bordered, muted). Buttons 6px/12–14px padding, 7px radius, 12px text.

**Live sequence (streaming):** On mount the assistant's *second* turn animates a realistic Claude Code run: a "Writing Blog Outline.md…" spinner row → the diff card appears → the answer text streams in character-by-character with a blinking accent caret → the permission prompt fades in. A footer "Claude is working… esc to interrupt" indicator (pulsing accent dot) shows until the run resolves. **The resting/default state is the completed conversation** (all blocks present, no timers required) — the animation is a progressive enhancement that always resolves to that state, even offscreen. Reproduce streaming from real SDK events; keep the "completed" state authoritative so nothing depends on an animation firing.

**Composer** (fixed, top border, `--bg`):
- A rounded input shell (`bg2`, 1px `bd2`, 12px radius, 10/12 padding) with placeholder "Reply to Claude…".
- Control row beneath: **mode chip** (accent-tinted pill: spark icon + current mode label + caret), **`+` add-context** icon button, spacer, **model** label (mono, faint, + caret), **send** button (28px, filled accent, white up-arrow).
- Above the shell, when working: the "Claude is working…" indicator.

### 2. Chat history (`view: "history"`)
Reached from `···` → "Chat history…". Replaces the whole pane.
- **Header**: back arrow (30px button) + "Chat history" (600,13px) + spacer + accent **"+ New"** pill (returns to a fresh chat).
- **Search field**: full-width, `bg2`/`bd2`, 8px radius, search icon + "Search chats…" placeholder.
- **Grouped session list**, scrolling. Group headers are uppercase faint labels: **Pinned**, **Today**, **Yesterday**, **Previous 7 days**. Each session row (9/10 padding, 9px radius, hover `bg3`): title (13px, 550) + right-aligned relative timestamp (mono, faint); one-line muted summary (ellipsized); a meta line of "N messages · Model · /Folder" (10.5px faint, mono for model/folder). The currently-open session is highlighted with `--accb` background and accent title/timestamp.

### 3. Settings (`view: "settings"`)
Reached from `···` → "Settings". Replaces the whole pane.
- **Header**: back arrow + "Settings".
- Scrolling list of **sections**, each an uppercase **accent-colored** label followed by setting rows separated by top borders (Obsidian's setting-item convention). Each row: left = name (13px,500) + muted description (11.5px/1.45); right = control.
- **Sections & rows:**
  - **General** — Model (dropdown pill → "Sonnet 4.5"), Permission mode (dropdown → "Default"), Working folder (dropdown → "/ Vault root").
  - **Permissions** — Confirm before running commands (toggle, on), Allow web fetch (toggle, on), Allowed tools (→ "Manage" button; subtitle lists Read, Edit, Bash, Grep, Glob, WebFetch).
  - **Context** — Index vault for search (toggle, on), Auto-add active note (toggle, off), Include backlinks (toggle, on).
  - **Behaviour** — Stream responses (toggle, on), Show thinking by default (toggle, off), Save captures to daily note (toggle, off).
  - **Connection** — Anthropic API key (mono masked `•••• 4f2a` + "Manage"), Claude Code CLI (green status dot + mono "v1.9 · detected").
  - **Appearance** — Match Obsidian theme (toggle, on), Accent colour (row of 4 selectable swatches; first selected with double-ring).
- **Toggle spec**: 36×21 track, 11px radius; ON = accent fill, knob right (17px white circle, top 2 / left 17); OFF = `bg3` fill + `bd2` border, knob left, muted knob.

---

## Menus (all open on click, close on outside-click via a full-pane backdrop at z-index 40; menus at z-index 50)

**Header `···` overflow** (opens down-right, min 226px): New chat · Chat history… · — · *VAULT*: Working folder (→ `/`) · Allowed tools… · Move to main tab · — · Export chat to note · Copy transcript · — · **Clear conversation** (red, `redb` hover) · Settings. "Chat history…" navigates to the history view; "Settings" to the settings view.

**Composer mode chip** (opens upward, min 248px) — *PERMISSION MODE*, four rows each with a colored status dot + name + faint description + check on the active one:
- **Default** (muted dot) — "ask before each edit"
- **Plan** (accent dot) — "read-only, propose first"
- **Auto-accept edits** (green dot) — "apply edits, ask for commands"
- **Auto** (yellow dot) — "run edits & commands hands-free"
- **Bypass permissions** (red dot, red text, `redb` hover) — "no prompts"

Selecting one updates the chip label. (These map to Claude Code's permission modes — wire to the SDK's real mode set.)

**Composer `+` add-context** (opens upward, min 236px) — *ADD TO CONTEXT*: Current note (→ mono `Notion.md`) · Selection · Search vault… · Linked notes & backlinks · Folder… · Today's daily note · — · Image or screenshot · Attach file…. These are the **Obsidian-native tools** — implement against the vault API (active file, selection, backlinks, daily-note plugin, file picker).

**Composer model picker** (opens upward, min 230px) — *MODEL*: Opus 4.6 ("deepest reasoning") · Sonnet 4.5 ("balanced default", default-checked) · Haiku 4.5 ("fastest"). Each: square accent chip + name + faint caption + check on active. Updates the model label.

---

## Interactions & Behavior
- **Expand/collapse**: every thinking/plan/search/fetch/diff block toggles open state independently on header click. Chevron rotates 0→90° over .15s. Defaults: plan & diff **open**, others **collapsed**.
- **Menus**: click trigger to toggle; one open at a time (`menu` holds a name or null). A transparent full-pane backdrop closes any open menu on outside click. Menu item clicks `stopPropagation`.
- **View navigation**: `···` items set `view`; back arrows and "+ New" return to `chat`.
- **Mode/model selection**: clicking a menu row sets `mode`/`model` and closes the menu; the trigger label reflects the choice; a check marks the active row.
- **Toggles**: flip a boolean in `settings` state; track color and knob position animate.
- **Streaming run** (see Chat thread above): timed enhancement that always resolves to the completed state; guarded so it completes even if the pane is offscreen/backgrounded. Replace with real SDK streaming events on implementation.
- **Hover states**: icon buttons and menu/list/setting rows get `--bg3` (or `--accb`/`--redb` for accent/danger) background on hover.

## State Management
Pane-level state to reproduce:
- `view`: `"chat" | "history" | "settings"`.
- `theme`: `"dark" | "light"` (in production, derive from Obsidian's active theme / `body.theme-dark`).
- `menu`: `null | "more" | "mode" | "add" | "model"` (which dropdown is open).
- `mode`: current permission mode string.
- `model`: current model string.
- `open`: per-block expand booleans `{ think1, plan, search, fetch, diff, think2 }`.
- `settings`: booleans `{ cmds, web, index, autoadd, backlinks, stream, thinking, daily, theme }`.
- Streaming-only: `phase` (0 running → 1 diff shown → 2 complete), `typed` (chars streamed), `streaming` (caret visible).

Real data needs: a session list (history), the active conversation's message/tool-call stream from the Agent SDK, current model & permission mode, and the settings store (persist via Obsidian plugin `saveData`).

## Design Tokens

Literal values used in the prototype (dark / light):

**Colors**
- bg (pane): `#1e1e1e` / `#ffffff`
- bg2 (cards, bubbles, input): `#1a1a1b` / `#f7f7f8`
- bg3 (hover, secondary buttons): `#27272a` / `#ececee`
- bgc (code/command blocks): `#151516` / `#f4f4f6`
- bd (borders/dividers): `rgba(255,255,255,.09)` / `rgba(0,0,0,.10)`
- bd2 (stronger borders): `rgba(255,255,255,.15)` / `rgba(0,0,0,.16)`
- tx (primary text): `#dcddde` / `#2e2e32`
- mut (secondary text): `#9a9aa0` / `#6a6a72`
- fnt (faint/meta text): `#6a6a72` / `#9a9aa2`
- acc (accent / Claude purple): `#a08bf5` / `#6c4ce0`
- accb (accent tint bg): `rgba(160,139,245,.15)` / `rgba(108,76,224,.10)`
- grn / grnb (additions, success): `#54cf90` · `rgba(84,207,144,.14)` / `#1f9c64` · `rgba(31,156,100,.11)`
- red / redb (danger, deletions): `#f0697a` · `rgba(240,105,122,.12)` / `#d6394b` · `rgba(214,57,75,.09)`
- ylw (caution mode / command icon): `#e6b450` / `#bd8a1e`
- menu shadow: `0 12px 32px rgba(0,0,0,.5), 0 3px 10px rgba(0,0,0,.34)` / `0 12px 32px rgba(0,0,0,.17), 0 3px 10px rgba(0,0,0,.09)`

**Typography**
- UI font: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
- Mono font: `ui-monospace, "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace`
- Sizes: body 13.5px/1.55–1.6; labels 11.5–12.5px; meta/faint 10.5–11px; section eyebrows 10–11px uppercase; answer title ~15px/650; code & diff 11.5px.

**Radii**: pane cards 9px; bubbles 10px; permission card & input shell 10–12px; icon buttons 6–7px; chips 7px; code blocks 7px; toggles 11px.

**Spacing**: list padding 16px 14px 10px; message blocks ~22px apart; card header padding 7–8px/10px; setting rows 12px vertical with 1px top borders; menu item padding 6px/9px.

**Icon set**: all icons are inline 1.5–2.6 stroke-weight SVGs at 10–17px (plus, more/3-dots, thinking-dot, plan-list, check, hollow-box, search, doc, globe, edit, send, spark, attach/plus, command-chevron, folder, image, calendar, link, history, export, copy, trash, sliders, selection, caret-down, back-arrow). Reproduce with Obsidian's bundled icon set (`setIcon`) where equivalents exist (search, file, links, history, trash, settings, etc.).

### Mapping to Obsidian (do this in production)
Replace the literal palette with Obsidian CSS variables so the pane inherits any theme:
- bg → `--background-primary`; bg2 → `--background-secondary`; bg3 → `--background-modifier-hover` / `--background-secondary-alt`; bgc → `--background-primary-alt`.
- bd → `--background-modifier-border`; bd2 → `--background-modifier-border-hover`.
- tx → `--text-normal`; mut → `--text-muted`; fnt → `--text-faint`.
- acc → `--interactive-accent` (text on accent → `--text-on-accent`); accent tint → `--interactive-accent` at reduced alpha.
- grn → `--color-green`; red → `--color-red` / `--text-error`; ylw → `--color-yellow`.
- Fonts → `--font-interface` and `--font-monospace`. Setting rows → Obsidian's `Setting` component / `.setting-item` markup. Mark the leaf `theme-dark`/`theme-light` automatically follows the app.

## Assets
None external. App glyph is a CSS square + rotated diamond; all icons are inline SVG. No images, no fonts to ship (system + Obsidian theme fonts). If a real plugin icon is desired, add one ribbon/leaf icon via `addIcon`.

## Files
- `ObsidianChatPane.dc.html` — the product design: chat, history, settings, menus, streaming. **This is the spec.**
- `Obsidian Claude Chat.dc.html` — review harness mounting the pane in all theme/size/view combinations. Visual index only.
- `support.js` — prototype runtime; do not port.

To preview the prototype: open either `.dc.html` in a browser (or the design tool). The harness shows everything at once; the pane file is what you implement against.
