# obsidi-claude

Obsidian plugin embedding a Claude Code chat pane. Native rendering (`createEl`/
`createDiv`/`setText` — no React), single `styles.css` built on Obsidian CSS
variables + Style Settings, esbuild → `main.js`, vitest, `tsc --noEmit`.

## Build / test

- `npm run build` — esbuild bundle to `main.js` (must exit 0)
- `npm test` — vitest
- `npx tsc --noEmit` — type check

## Gotchas

- **`main` ships RED — gate on "zero new regressions," not green.** As of
  2026-06, baseline `main` carries ~94 `tsc --noEmit` errors and ~8 vitest
  failures (pre-existing in `obsidianTools.ts`, `settingsTab.ts`,
  `ObsidianTools.test.ts`). "Tests must pass" is unsatisfiable here. **Measure the
  baseline first** (`git stash` to confirm a failure is pre-existing), then hold
  the deltas constant: build exit 0, tsc error *count* unchanged, vitest
  pass/fail delta zero. Don't panic at red and don't block a commit on green.
- **Test doubles for `createEl`/`createSpan`/`createDiv` must accept the object
  form, not just strings.** Obsidian's real DOM helpers take both
  `createSpan("text")` and `createSpan({cls, text, attr})`. A polyfill/mock that
  only accepts a string arg will fail *correct* source that uses the object form
  (this masked a Phase-3 card-renderer change as a source bug when the bug was the
  narrow double). Fix the double, not the source.

## Visual design

Chat pane adopts a vendored design handoff (`docs/design/chat-pane-handoff/`) via
a semantic `--occ-*` CSS token layer scoped to `.obsidi-claude-container`
(maps handoff hex → Obsidian CSS variables). Restyle against the tokens; avoid
hardcoded hex so dark/light theme tracking holds. Settings stay in the canonical
`PluginSettingTab` (the in-pane settings view from the handoff is deferred).
