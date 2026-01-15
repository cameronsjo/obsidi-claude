import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SkillLoader } from '../src/skills/skillLoader';
import { SkillRegistry } from '../src/skills/skillRegistry';
import type { Skill, SkillSettings } from '../src/types';
import type { App, TFile, TFolder } from 'obsidian';

// Create mock App
function createMockApp(): App {
  const files: Map<string, { file: TFile; content: string }> = new Map();

  const mockVault = {
    getAbstractFileByPath: vi.fn((path: string) => {
      if (path === '.claude/skills') {
        return { path: '.claude/skills' } as TFolder;
      }
      const entry = files.get(path);
      return entry?.file ?? null;
    }),
    getMarkdownFiles: vi.fn(() => Array.from(files.values()).map((e) => e.file)),
    read: vi.fn(async (file: TFile) => {
      const entry = files.get(file.path);
      return entry?.content ?? '';
    }),
    // Helper to add test files
    _addFile: (path: string, content: string) => {
      const file: TFile = {
        path,
        name: path.split('/').pop() ?? '',
        basename: (path.split('/').pop() ?? '').replace(/\.md$/, ''),
        extension: 'md',
        stat: { ctime: Date.now(), mtime: Date.now(), size: content.length },
        vault: mockVault,
        parent: null,
      } as TFile;
      files.set(path, { file, content });
    },
    _clearFiles: () => files.clear(),
  };

  return {
    vault: mockVault,
    workspace: {} as App['workspace'],
    metadataCache: {} as App['metadataCache'],
    fileManager: {} as App['fileManager'],
  } as unknown as App;
}

describe('SkillLoader', () => {
  let app: ReturnType<typeof createMockApp>;
  let loader: SkillLoader;
  const defaultSettings: SkillSettings = {
    enabled: true,
    folderPath: '.claude/skills',
  };

  beforeEach(() => {
    app = createMockApp();
    loader = new SkillLoader(app, defaultSettings);
  });

  describe('loadSkills', () => {
    it('should return empty array when disabled', async () => {
      const disabledLoader = new SkillLoader(app, { ...defaultSettings, enabled: false });
      const skills = await disabledLoader.loadSkills();
      expect(skills).toHaveLength(0);
    });

    it('should return empty array when folder not found', async () => {
      (app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const skills = await loader.loadSkills();
      expect(skills).toHaveLength(0);
    });

    it('should load a simple skill file', async () => {
      const content = `---
name: test-skill
description: A test skill
triggers:
  - hello
  - world
---

# Test Skill

This is the skill content.`;

      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/test.md',
        content
      );

      const skills = await loader.loadSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('test-skill');
      expect(skills[0].description).toBe('A test skill');
      expect(skills[0].triggers).toEqual(['hello', 'world']);
      expect(skills[0].content).toBe('# Test Skill\n\nThis is the skill content.');
    });

    it('should use filename as name when not in frontmatter', async () => {
      const content = `---
description: No name specified
---

Content here.`;

      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/my-skill.md',
        content
      );

      const skills = await loader.loadSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('my-skill');
    });

    it('should handle alwaysActive flag', async () => {
      const content = `---
name: always-on
alwaysActive: true
---

Always active content.`;

      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/always.md',
        content
      );

      const skills = await loader.loadSkills();
      expect(skills[0].alwaysActive).toBe(true);
    });

    it('should handle tools array', async () => {
      const content = `---
name: tool-skill
tools:
  - obsidian_search
  - read_file
---

Tool-specific skill.`;

      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/tools.md',
        content
      );

      const skills = await loader.loadSkills();
      expect(skills[0].tools).toEqual(['obsidian_search', 'read_file']);
    });

    it('should skip files with no content', async () => {
      const content = `---
name: empty-skill
---
`;

      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/empty.md',
        content
      );

      const skills = await loader.loadSkills();
      expect(skills).toHaveLength(0);
    });

    it('should handle files without frontmatter', async () => {
      const content = `# Just Content

No frontmatter here.`;

      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/no-frontmatter.md',
        content
      );

      const skills = await loader.loadSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('no-frontmatter');
      expect(skills[0].content).toBe('# Just Content\n\nNo frontmatter here.');
    });

    it('should handle inline array syntax', async () => {
      const content = `---
name: inline-arrays
triggers: [foo, bar, baz]
---

Content.`;

      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/inline.md',
        content
      );

      const skills = await loader.loadSkills();
      expect(skills[0].triggers).toEqual(['foo', 'bar', 'baz']);
    });

    it('should handle quoted values', async () => {
      const content = `---
name: "quoted-name"
description: 'quoted description'
---

Content.`;

      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/quoted.md',
        content
      );

      const skills = await loader.loadSkills();
      expect(skills[0].name).toBe('quoted-name');
      expect(skills[0].description).toBe('quoted description');
    });
  });

  describe('getSkills', () => {
    it('should return loaded skills', async () => {
      const content = `---
name: test
---

Content.`;

      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/test.md',
        content
      );

      await loader.loadSkills();
      const skills = loader.getSkills();
      expect(skills).toHaveLength(1);
    });
  });

  describe('getSkill', () => {
    it('should return skill by name', async () => {
      const content = `---
name: find-me
---

Content.`;

      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/find.md',
        content
      );

      await loader.loadSkills();
      const skill = loader.getSkill('find-me');
      expect(skill).toBeDefined();
      expect(skill?.name).toBe('find-me');
    });

    it('should return undefined for unknown skill', async () => {
      await loader.loadSkills();
      const skill = loader.getSkill('nonexistent');
      expect(skill).toBeUndefined();
    });
  });

  describe('updateSettings', () => {
    it('should update settings', () => {
      const newSettings = { enabled: false, folderPath: '.custom/skills' };
      loader.updateSettings(newSettings);
      // Settings are private, but we can verify behavior
    });
  });
});

describe('SkillRegistry', () => {
  let app: ReturnType<typeof createMockApp>;
  let registry: SkillRegistry;
  const defaultSettings: SkillSettings = {
    enabled: true,
    folderPath: '.claude/skills',
  };

  beforeEach(() => {
    app = createMockApp();
    registry = new SkillRegistry(app, defaultSettings);
  });

  describe('initialize', () => {
    it('should load skills on initialization', async () => {
      const content = `---
name: init-skill
triggers:
  - test
---

Content.`;

      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/init.md',
        content
      );

      await registry.initialize();
      const skills = registry.getSkills();
      expect(skills).toHaveLength(1);
    });

    it('should skip initialization when disabled', async () => {
      const disabledRegistry = new SkillRegistry(app, { ...defaultSettings, enabled: false });
      await disabledRegistry.initialize();
      expect(disabledRegistry.getSkills()).toHaveLength(0);
    });

    it('should only initialize once', async () => {
      await registry.initialize();
      await registry.initialize(); // Second call should be no-op
      // No error thrown means success
    });
  });

  describe('matchSkills', () => {
    beforeEach(async () => {
      // Add test skills
      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/greeting.md',
        `---
name: greeting
triggers:
  - hello
  - hi
---
Greeting content.`
      );

      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/coding.md',
        `---
name: coding
triggers:
  - code
  - programming
---
Coding content.`
      );

      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/always.md',
        `---
name: always-on
alwaysActive: true
---
Always active.`
      );

      await registry.initialize();
    });

    it('should match skills by trigger', () => {
      const matched = registry.matchSkills('hello world');
      expect(matched).toHaveLength(2); // greeting + always-on
      expect(matched.map((s) => s.name)).toContain('greeting');
    });

    it('should match case-insensitively', () => {
      const matched = registry.matchSkills('HELLO there');
      expect(matched.map((s) => s.name)).toContain('greeting');
    });

    it('should always include alwaysActive skills', () => {
      const matched = registry.matchSkills('random message');
      expect(matched).toHaveLength(1);
      expect(matched[0].name).toBe('always-on');
    });

    it('should match multiple skills', () => {
      const matched = registry.matchSkills('hello, let me show you some code');
      expect(matched).toHaveLength(3); // greeting + coding + always-on
    });

    it('should return empty when disabled', async () => {
      const disabledRegistry = new SkillRegistry(app, { ...defaultSettings, enabled: false });
      const matched = disabledRegistry.matchSkills('hello');
      expect(matched).toHaveLength(0);
    });
  });

  describe('matchByTools', () => {
    beforeEach(async () => {
      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/search.md',
        `---
name: search-skill
tools:
  - obsidian_search
  - vault_search
---
Search content.`
      );

      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/write.md',
        `---
name: write-skill
tools:
  - create_note
---
Write content.`
      );

      await registry.initialize();
    });

    it('should match skills by tool name', () => {
      const matched = registry.matchByTools(['obsidian_search']);
      expect(matched).toHaveLength(1);
      expect(matched[0].name).toBe('search-skill');
    });

    it('should match multiple skills', () => {
      const matched = registry.matchByTools(['obsidian_search', 'create_note']);
      expect(matched).toHaveLength(2);
    });

    it('should return empty for unknown tools', () => {
      const matched = registry.matchByTools(['unknown_tool']);
      expect(matched).toHaveLength(0);
    });
  });

  describe('buildSystemPrompt', () => {
    beforeEach(async () => {
      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/test.md',
        `---
name: test-skill
description: A helpful skill
triggers:
  - help
---
Use these instructions when helping.`
      );

      await registry.initialize();
    });

    it('should return base prompt when no skills match', () => {
      const result = registry.buildSystemPrompt('Base prompt', 'random message');
      expect(result).toBe('Base prompt');
    });

    it('should inject matching skills', () => {
      const result = registry.buildSystemPrompt('Base prompt', 'I need help');
      expect(result).toContain('Base prompt');
      expect(result).toContain('<active_skills>');
      expect(result).toContain('## test-skill');
      expect(result).toContain('*A helpful skill*');
      expect(result).toContain('Use these instructions when helping.');
      expect(result).toContain('</active_skills>');
    });

    it('should return base prompt when disabled', async () => {
      const disabledRegistry = new SkillRegistry(app, { ...defaultSettings, enabled: false });
      const result = disabledRegistry.buildSystemPrompt('Base prompt', 'help me');
      expect(result).toBe('Base prompt');
    });

    it('should deduplicate skills matched by both message and tools', async () => {
      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/dual.md',
        `---
name: dual-skill
triggers:
  - search
tools:
  - obsidian_search
---
Dual match content.`
      );

      await registry.reload();

      const result = registry.buildSystemPrompt('Base', 'search for something', ['obsidian_search']);
      // Should only appear once
      const matches = result.match(/## dual-skill/g);
      expect(matches).toHaveLength(1);
    });
  });

  describe('updateSettings', () => {
    it('should reload skills when folder changes', async () => {
      await registry.initialize();

      // Change folder
      const newSettings = { ...defaultSettings, folderPath: '.other/skills' };
      (app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation((path) => {
        if (path === '.other/skills') return { path: '.other/skills' };
        return null;
      });

      await registry.updateSettings(newSettings);
      // Skills should be empty now (no files in new folder)
      expect(registry.getSkills()).toHaveLength(0);
    });
  });

  describe('reload', () => {
    it('should reload skills from disk', async () => {
      await registry.initialize();

      // Add new file
      (app.vault as ReturnType<typeof createMockApp>['vault'])._addFile(
        '.claude/skills/new.md',
        `---
name: new-skill
---
New content.`
      );

      await registry.reload();
      expect(registry.getSkills()).toHaveLength(1);
    });
  });
});
