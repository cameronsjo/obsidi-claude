/**
 * Bundled skills that ship with the plugin.
 * These can be automatically installed to the user's skills folder.
 *
 * Based on kepano/obsidian-skills (MIT License)
 * https://github.com/kepano/obsidian-skills
 */

export interface BundledSkill {
  /** Filename for the skill (e.g., "obsidian-markdown.md") */
  filename: string;
  /** Full content of the skill file including frontmatter */
  content: string;
}

/**
 * Obsidian Markdown skill by kepano
 * Teaches Claude about Obsidian-specific markdown syntax
 */
const OBSIDIAN_MARKDOWN_SKILL = `---
name: obsidian-markdown
description: Create and edit Obsidian Flavored Markdown with wikilinks, embeds, callouts, properties, and other Obsidian-specific syntax.
triggers:
  - wikilink
  - callout
  - frontmatter
  - embed
  - obsidian
  - markdown
  - note
alwaysActive: true
---

# Obsidian Flavored Markdown

This skill enables creating and editing valid Obsidian Flavored Markdown.

## Internal Links (Wikilinks)

\`\`\`markdown
[[Note Name]]
[[Note Name|Display Text]]
[[Note Name#Heading]]
[[Note Name#^block-id]]
[[#Heading in same note]]
\`\`\`

## Embeds

\`\`\`markdown
![[Note Name]]
![[Note Name#Heading]]
![[image.png]]
![[image.png|300]]         Width only
![[image.png|640x480]]     Width x Height
![[document.pdf#page=3]]
\`\`\`

## Callouts

\`\`\`markdown
> [!note]
> Basic callout

> [!warning] Custom Title
> With custom title

> [!tip]- Collapsed by default
> Foldable content

> [!info]+ Expanded by default
> Foldable content (expanded)
\`\`\`

**Types:** note, abstract, info, todo, tip, success, question, warning, failure, danger, bug, example, quote

## Properties (Frontmatter)

\`\`\`yaml
---
title: My Note
date: 2024-01-15
tags:
  - project
  - important
aliases:
  - Alternative Name
status: in-progress
rating: 4.5
completed: false
---
\`\`\`

## Tags

\`\`\`markdown
#tag
#nested/tag
#tag-with-dashes
\`\`\`

## Task Lists

\`\`\`markdown
- [ ] Incomplete task
- [x] Completed task
\`\`\`

## Code Blocks

\`\`\`\`markdown
\`\`\`javascript
console.log("Hello");
\`\`\`
\`\`\`\`

## Math (LaTeX)

\`\`\`markdown
Inline: $e^{i\\pi} + 1 = 0$

Block:
$$
\\frac{a}{b}
$$
\`\`\`

## Comments

\`\`\`markdown
Visible %%hidden%% text

%%
Hidden block
%%
\`\`\`

## Block References

Add \`^block-id\` at end of paragraph to make it linkable:

\`\`\`markdown
This paragraph can be linked. ^my-id

Then link with [[Note#^my-id]]
\`\`\`

## References

- [Obsidian Help: Basic Syntax](https://help.obsidian.md/syntax)
- [Obsidian Help: Callouts](https://help.obsidian.md/callouts)
- [Obsidian Help: Properties](https://help.obsidian.md/properties)

*Based on [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) (MIT License)*
`;

export const BUNDLED_SKILLS: BundledSkill[] = [
  {
    filename: 'obsidian-markdown.md',
    content: OBSIDIAN_MARKDOWN_SKILL,
  },
];
