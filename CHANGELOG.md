# Changelog

## 1.0.0 (2026-01-19)


### Features

* **embedding:** add transformers.js via WebWorker pattern ([0d44908](https://github.com/cameronsjo/obsidi-claude/commit/0d4490805d324cec819f056e2c5a0f63b6368d16))
* initial Obsidi-Claude plugin ([0dda2fe](https://github.com/cameronsjo/obsidi-claude/commit/0dda2fe4ae64c2af740db3280282ff86efe3d787))
* major UX overhaul and hybrid backend architecture ([2632972](https://github.com/cameronsjo/obsidi-claude/commit/26329724bda75e9d79a75b2e3041a54e14b90e61))
* **mcp:** add HTTP transport support ([b027453](https://github.com/cameronsjo/obsidi-claude/commit/b0274530f877bd47b0ea541b7a8c6036963d9a49))
* **ux:** add slash commands, active note context, and token counter ([8475476](https://github.com/cameronsjo/obsidi-claude/commit/8475476f39d1e996d1f0400c69c28c557ac3dad2))


### Bug Fixes

* **embedding:** prevent race condition in worker initialization ([917360e](https://github.com/cameronsjo/obsidi-claude/commit/917360e9655c9577febdf20f3bb6d0b388f945aa))
* **embedding:** use @xenova/transformers v2.x for better compatibility ([2601c23](https://github.com/cameronsjo/obsidi-claude/commit/2601c2348614cccd8c50d2c82846c34f2c7456cb))
* **embedding:** use importScripts for classic worker compatibility ([6d9b091](https://github.com/cameronsjo/obsidi-claude/commit/6d9b091845f2605ee930a098eca802bfdc025e3b))
* enhance PATH for subprocess to find node in Electron ([d390bed](https://github.com/cameronsjo/obsidi-claude/commit/d390bed5a7e24ae6eab03a5eb1a51ab137f67b50))
* prevent message duplication from SDK streaming ([2c34863](https://github.com/cameronsjo/obsidi-claude/commit/2c34863eea57a568b11ba5cdc58bbf4f9f3f696c))
* remove transformers.js provider, add external MCP servers ([4ff0f7a](https://github.com/cameronsjo/obsidi-claude/commit/4ff0f7a0cf6084dc1a91c6c5f57785ea67c15a30))
* set release-please manifest to 0.0.0 for initial release ([c9daa87](https://github.com/cameronsjo/obsidi-claude/commit/c9daa87ca4837d2c5b5a3369c688d64cadc5a395))
* set release-please manifest to 0.0.0 for initial release ([ed34b25](https://github.com/cameronsjo/obsidi-claude/commit/ed34b25101c17ce03f8423fd9c0042b27b4185ba))
