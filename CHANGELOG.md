# Changelog

## [1.3.0](https://github.com/cameronsjo/obsidi-claude/compare/1.2.0...1.3.0) (2026-06-25)


### Features

* add Claude Code plugin with onboarding skill ([de77d30](https://github.com/cameronsjo/obsidi-claude/commit/de77d30e2242c6e4359ec094e51a38124473c9cf))
* **cli-bridge:** add Obsidian CLI bridge for Sync history, file recovery, and diff ([e2dfbe9](https://github.com/cameronsjo/obsidi-claude/commit/e2dfbe9c4bf3f3ea50fbcc5ce9bda7d9413bde15))


### Bug Fixes

* **ci:** use env variables for GitHub Actions expressions in run blocks ([4d73e20](https://github.com/cameronsjo/obsidi-claude/commit/4d73e2089820785f02d579a73d65159a383e98ff))
* **cli-bridge:** add minimum version check (&gt;= 1.12.0) during initialization ([e4f46dd](https://github.com/cameronsjo/obsidi-claude/commit/e4f46dd3524f25cf816c19877c34e2669c90771b))
* **cli-bridge:** gate on running Obsidian app version before CLI init ([14cb482](https://github.com/cameronsjo/obsidi-claude/commit/14cb482c3bc4ff3ddb0ca3a79ea9c4fd784d2794))

## [1.2.0](https://github.com/cameronsjo/obsidi-claude/compare/1.1.0...1.2.0) (2026-02-08)


### Features

* **mcp:** add elicitation confirmation for delete tool ([2d86792](https://github.com/cameronsjo/obsidi-claude/commit/2d86792cde37844d02546a3ab668ceb4d63f720b))
* **mcp:** add get_instructions tool and write verification to all mutating tools ([59e5ce1](https://github.com/cameronsjo/obsidi-claude/commit/59e5ce122f8239cf6d15c772ddd31c4b83a8dfb8))
* **mcp:** add resources, completions, roots, and typed elicitation ([8ce05f6](https://github.com/cameronsjo/obsidi-claude/commit/8ce05f62a63fa2c78c019035b32d45a3d0f8dd6f))
* **mcp:** forward structured logs to connected MCP clients ([01e1f97](https://github.com/cameronsjo/obsidi-claude/commit/01e1f9741006193a13b9af69d0a9ccc173e7e06c))


### Bug Fixes

* **deps:** update @modelcontextprotocol/sdk to 1.26.0 ([014f938](https://github.com/cameronsjo/obsidi-claude/commit/014f9388eee607278f9b9d16e515ae766b265631))

## [1.1.0](https://github.com/cameronsjo/obsidi-claude/compare/1.0.1...1.1.0) (2026-02-01)


### Features

* add /budget, /cost commands and main agent option ([7aa0bed](https://github.com/cameronsjo/obsidi-claude/commit/7aa0bedfe9f63acc85ce8e00b9afd606d7dc456c))
* add /mode command for runtime permission mode switching ([5388a94](https://github.com/cameronsjo/obsidi-claude/commit/5388a94400a7e950d2003ae54d33479d53ee40e9))
* add /skills command and SDK session forking ([7508d7a](https://github.com/cameronsjo/obsidi-claude/commit/7508d7aaf911d5cd2f3e6aabc111905236604c3d))
* add /undo command for file rewind ([7bd2b5b](https://github.com/cameronsjo/obsidi-claude/commit/7bd2b5bc34874c56b94df49643307d25dd849ce5))
* add beta release workflow ([f06d65a](https://github.com/cameronsjo/obsidi-claude/commit/f06d65add8db7f6f49d20fccf378f87094812e8a))
* add beta release workflow ([b1fa9b6](https://github.com/cameronsjo/obsidi-claude/commit/b1fa9b65e655cd47ab120a3cad4933377bc25a21))
* add command palette and editor context menu integration ([3590a03](https://github.com/cameronsjo/obsidi-claude/commit/3590a030584b5a2b70715807efeccc5440eeef0c))
* add comprehensive SDK feature support ([479ab52](https://github.com/cameronsjo/obsidi-claude/commit/479ab52d247d90fed05f89a9a69ea8b1bd488be8))
* add conversation duplication (forking) ([bd3de39](https://github.com/cameronsjo/obsidi-claude/commit/bd3de3911b1b223e5dcc3b9cd0023ef2aa71b394))
* add conversation history browser and note generation ([0a82073](https://github.com/cameronsjo/obsidi-claude/commit/0a8207375060eea9c37adffbe9227bd757a5699f))
* add conversation pinning, renaming, and message reactions ([c39cb78](https://github.com/cameronsjo/obsidi-claude/commit/c39cb78c40e0456e2ebcb136a2f589793e139586))
* add custom subagents and dynamic model support ([be62870](https://github.com/cameronsjo/obsidi-claude/commit/be6287068ef02ef991688230c7a0c0a3bd3ac0ee))
* add ephemeral/privacy mode for SDK sessions ([24430e8](https://github.com/cameronsjo/obsidi-claude/commit/24430e86861e2466e93145c74d94905798582566))
* add extensive slash command support ([aae28d6](https://github.com/cameronsjo/obsidi-claude/commit/aae28d686f135ccb6830a2d8da0c31f922c465a5))
* add fallback model and account info display ([500fcc1](https://github.com/cameronsjo/obsidi-claude/commit/500fcc169283b9d19eb8fa09023aac57e07116ef))
* add image/screenshot input support for multimodal conversations ([51bb56e](https://github.com/cameronsjo/obsidi-claude/commit/51bb56e371a5a67e81393256a5f1b676ee30a6bf))
* add keyboard shortcuts for common actions ([665e783](https://github.com/cameronsjo/obsidi-claude/commit/665e783704698456d8b65874d3e1a22ef69a31ca))
* add MCP server health monitoring and control ([65d9b0e](https://github.com/cameronsjo/obsidi-claude/commit/65d9b0eb9e03f448a2b10f80a2c6eb55617947c5))
* add MCP transport support and agent SDK enhancements ([6e95c20](https://github.com/cameronsjo/obsidi-claude/commit/6e95c20eaec578b0c27af7bc53ee39614f6c99e2))
* add message bookmarking ([ffce5e0](https://github.com/cameronsjo/obsidi-claude/commit/ffce5e03bacb79ae60d8f3bcc4a93d188e390d80))
* add Obsidian markdown syntax to default system prompt ([3099b06](https://github.com/cameronsjo/obsidi-claude/commit/3099b0657130e065686c6059de1a428473ac1df6))
* add prompt library with saved templates ([080f56a](https://github.com/cameronsjo/obsidi-claude/commit/080f56a938e0b49284de862cd49a89821da83793))
* add resume-at-point for conversation replay ([1b9e3d5](https://github.com/cameronsjo/obsidi-claude/commit/1b9e3d5befc52112fda8319d60ecfd06ebd90365))
* add sandbox settings for secure command execution ([0dd559a](https://github.com/cameronsjo/obsidi-claude/commit/0dd559a4db39df5cc14fcba551f1d78b0885f1b3))
* add search bar in history panel ([f713256](https://github.com/cameronsjo/obsidi-claude/commit/f71325647041116d370b6ecc8ee89a89997a4d56))
* add selected text context support ([38749a2](https://github.com/cameronsjo/obsidi-claude/commit/38749a2c5a1915203120fd69840289e57bf62e6e))
* add system prompt append, continue session, disallowedTools ([9a6c16a](https://github.com/cameronsjo/obsidi-claude/commit/9a6c16a09c19ccec40666b7c7302ae9154da8c01))
* add tag filtering in history panel ([41ccd83](https://github.com/cameronsjo/obsidi-claude/commit/41ccd83c6d890624594c61883c97d4eb9e52cf43))
* add tag management modal in history panel ([827dfd7](https://github.com/cameronsjo/obsidi-claude/commit/827dfd74165bec14149428ec9cd15ad3ebeb7b34))
* add token usage tracking and cost dashboard ([30c908d](https://github.com/cameronsjo/obsidi-claude/commit/30c908d2147b75248458a8bac3ef5a17ab19a7fa))
* add vault CLAUDE.md loading and file sync events ([bee7b06](https://github.com/cameronsjo/obsidi-claude/commit/bee7b068f98f66076b7f5caeadf2aebfac5f3c43))
* add version/about page and message queue functionality ([22f984f](https://github.com/cameronsjo/obsidi-claude/commit/22f984f09f587db0b851948c0ab26dae5118af4f))
* add version/about page and message queue functionality ([072dd7f](https://github.com/cameronsjo/obsidi-claude/commit/072dd7fc2a470ab38757ba11530f6a14ae73b711))
* add voice input using Web Speech API ([60aa3c1](https://github.com/cameronsjo/obsidi-claude/commit/60aa3c1008a3c7e3fa464d68172e7de94f55251d))
* **agents:** add criticalSystemReminder support ([95b4a91](https://github.com/cameronsjo/obsidi-claude/commit/95b4a91aee6e67025329be4cadd805f30bfbc8d2))
* **editor:** add inline completion service for ghost text ([636fbeb](https://github.com/cameronsjo/obsidi-claude/commit/636fbeb07bc4580f9a73c9deab2cd1e2456a14d3))
* enable mobile support with platform-aware UI ([07763ff](https://github.com/cameronsjo/obsidi-claude/commit/07763ff4b5d76e79b5dab8416796c5954f22ad04)), closes [#10](https://github.com/cameronsjo/obsidi-claude/issues/10)
* **export:** add clipboard and JSON export options ([3b366c8](https://github.com/cameronsjo/obsidi-claude/commit/3b366c88636f57313384f57bb6e4874a9328f265))
* implement Obsidian SecretStorage for API key ([587350d](https://github.com/cameronsjo/obsidi-claude/commit/587350d85b7aeb0fd9f31f4ee9375a714adfe425))
* leverage full SDK capabilities ([9528b97](https://github.com/cameronsjo/obsidi-claude/commit/9528b97a30f8782e03ee8ef7345e6cc62230555c))
* **mcp:** add canvas support with create_canvas tool ([d4797e8](https://github.com/cameronsjo/obsidi-claude/commit/d4797e8d35f247aca668b441160d4fffc272f80c))
* **mcp:** add dynamic MCP server management ([f4d4b4f](https://github.com/cameronsjo/obsidi-claude/commit/f4d4b4f9942ae4a3e6dbe36fffcaba44eff4495c))
* **mcp:** add set_frontmatter tool for YAML metadata ([3dc0878](https://github.com/cameronsjo/obsidi-claude/commit/3dc0878f8fab1d0e15fa74443a217d5f4975fdd3))
* **mcp:** add strictMcpConfig for validation ([1a06875](https://github.com/cameronsjo/obsidi-claude/commit/1a06875af643d2a04d5ee79db3c8e01e841e7a43))
* **mcp:** add template support with list_templates and create_from_template ([416960e](https://github.com/cameronsjo/obsidi-claude/commit/416960e1857e573d4285584f7b04bcec92dfbbc4))
* **sdk:** add plugin loading support ([eec428e](https://github.com/cameronsjo/obsidi-claude/commit/eec428e5635d0138af4f2ad0db32cd8e2a148e95))
* **sdk:** add spawnClaudeCodeProcess for remote execution ([50fc253](https://github.com/cameronsjo/obsidi-claude/commit/50fc25394271610c2a5ac73c628d9511aa54947f))
* **sdk:** add V2 Session API support (experimental) ([10d1840](https://github.com/cameronsjo/obsidi-claude/commit/10d1840689f2fce71f0e82ee3de50217779ffc62))
* **settings:** add SDK advanced options UI ([f43f80c](https://github.com/cameronsjo/obsidi-claude/commit/f43f80c37a55b3f617c951f9ba308359f65fa0bd))
* **settings:** add toggle to disable message actions ([484b4df](https://github.com/cameronsjo/obsidi-claude/commit/484b4dfb30c8c94c4c7f4c0a21389af58a573765))
* **settings:** dynamic model selection with SDK support ([b03d5c5](https://github.com/cameronsjo/obsidi-claude/commit/b03d5c515b08eb7c2cd80b569943118b2eea4fec))
* **skills:** add bundled Obsidian Markdown skill from kepano ([183f2d7](https://github.com/cameronsjo/obsidi-claude/commit/183f2d7a3361ec453c31223504600fcb90e5261b))
* smart titles, cost display, and UX improvements ([af046f0](https://github.com/cameronsjo/obsidi-claude/commit/af046f0a36a53c4a0cd257d9758f568044f83745))
* **storage:** add vault-based conversation storage for cross-device sync ([f9fb3e9](https://github.com/cameronsjo/obsidi-claude/commit/f9fb3e96ea98a621d1d0d50e8fd04da31f0b126b))
* support shared anthropic-api-key secret ([b1cdc39](https://github.com/cameronsjo/obsidi-claude/commit/b1cdc39b9e654d8e70f25ad882b8c11031b51bd2))
* **tools:** add Dataview query integration ([8f7ef13](https://github.com/cameronsjo/obsidi-claude/commit/8f7ef134cf4818063f990c7759bcacf618ec6e93))
* **tools:** add graph analysis tools ([ad6ead5](https://github.com/cameronsjo/obsidi-claude/commit/ad6ead5c916bea2cbd961f56c3db517d829f528f))
* **tools:** add tag management tools ([c545d0f](https://github.com/cameronsjo/obsidi-claude/commit/c545d0f2ca47ef693a1972532bfcb1814bfd3fde))
* track SDK message UUIDs for checkpoint/rewind ([a7a18e9](https://github.com/cameronsjo/obsidi-claude/commit/a7a18e97dd71d7fc4aadc814d862939010311628))
* **ui:** add conversation tabs for multi-chat support ([c03416c](https://github.com/cameronsjo/obsidi-claude/commit/c03416c05a993e540191cb945c0a292d250a8eab))
* **ui:** add file explorer context menu integration ([360c3cf](https://github.com/cameronsjo/obsidi-claude/commit/360c3cf81ac84baf79d8349f1d37c0f2c816a977))
* **ui:** add keyboard shortcut commands for chat ([b44a55e](https://github.com/cameronsjo/obsidi-claude/commit/b44a55e465d5d0b73defad6b0f405a738f5eb41b))
* **ui:** add mobile-optimized UI support ([0ef2737](https://github.com/cameronsjo/obsidi-claude/commit/0ef273747406195bdcf023a8a6141ccd85833286))
* **ui:** add native permission modal for tool requests ([8c43296](https://github.com/cameronsjo/obsidi-claude/commit/8c43296de861d7bb077eec8d6238842b88fdab65))
* **ui:** add slash command autocomplete ([d735b8a](https://github.com/cameronsjo/obsidi-claude/commit/d735b8a07ad193caa4bae1c556d0dbd4e31920bb))
* **ui:** add status bar widget for Claude ([a9db6c1](https://github.com/cameronsjo/obsidi-claude/commit/a9db6c1244b22f9919fdae513c1ffa4d5a03ae51))
* **ui:** move message actions below content ([1e39ac5](https://github.com/cameronsjo/obsidi-claude/commit/1e39ac5dcbba13baefedad8e1e828dd1418714aa))


### Bug Fixes

* **ci:** properly cleanup beta tag before recreating ([c0b2105](https://github.com/cameronsjo/obsidi-claude/commit/c0b2105df6853ab686eef9095a30f2d2739eb351))
* **ci:** quote if condition to fix YAML parsing ([d590caa](https://github.com/cameronsjo/obsidi-claude/commit/d590caa96ecf9ced09a913384ecef63cc01786d2))
* **ci:** recreate beta release for fresh timestamps ([641151f](https://github.com/cameronsjo/obsidi-claude/commit/641151f21b070f5ecc9ef9bcdbc6c7079567a582))
* improve send button alignment, note context handling, and processing indicators ([9fae148](https://github.com/cameronsjo/obsidi-claude/commit/9fae148d3495f476095184fdc032d1a7210da5b7))
* improve send button alignment, note context handling, and processing indicators ([9e9462f](https://github.com/cameronsjo/obsidi-claude/commit/9e9462fc9f56afd20558a0d539b62db384ad79e0))
* improve status bar and input styling ([fe4d98f](https://github.com/cameronsjo/obsidi-claude/commit/fe4d98f7a065bc18eb556cf8dd0ffe05807f9852))
* model dropdown and beta version incrementing ([a7ff08f](https://github.com/cameronsjo/obsidi-claude/commit/a7ff08f0410896ffebadcfab3af40da00278aaae))
* remove null trigger causing extension TypeError ([1de4d9f](https://github.com/cameronsjo/obsidi-claude/commit/1de4d9fb91738ab57a0fc40c094494aff0299bd8))
* resolve chat UI bugs ([9e44efb](https://github.com/cameronsjo/obsidi-claude/commit/9e44efb6a5605fef01e2da9311eb95c719b7a125))
* **ui:** clean up error messages, no stack traces ([f38bb8e](https://github.com/cameronsjo/obsidi-claude/commit/f38bb8e5aed9584df5eb2174755c3a85a1f554db))
* **ui:** handle model changes and improve error UX ([f1c031a](https://github.com/cameronsjo/obsidi-claude/commit/f1c031ad24de22610f5fca792affc7f862e397f2))
* use full note content when delta is larger ([a050da5](https://github.com/cameronsjo/obsidi-claude/commit/a050da50ab9e5ed1f3e198267bf4cf8a06795252))

## [1.0.1](https://github.com/cameronsjo/obsidi-claude/compare/1.0.0...1.0.1) (2026-01-29)


### Bug Fixes

* optimize token usage and add Style Settings support ([6735190](https://github.com/cameronsjo/obsidi-claude/commit/6735190835536de29520d7003cf3cb716b6babc3))
* optimize token usage and add Style Settings support ([e205f03](https://github.com/cameronsjo/obsidi-claude/commit/e205f03ec9468ffbfddaa2cc37c1d7c7b60e1a64))

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
