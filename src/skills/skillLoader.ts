import type { App, TFile } from 'obsidian';
import type { Skill, SkillSettings } from '../types';
import { createLogger } from '../logger';

const log = createLogger('SkillLoader');

/**
 * YAML frontmatter structure for SKILL.md files.
 */
interface SkillFrontmatter {
  name?: string;
  description?: string;
  triggers?: string[];
  tools?: string[];
  alwaysActive?: boolean;
}

/**
 * Loads and parses SKILL.md files from the vault.
 *
 * Skills are markdown files with YAML frontmatter that define context
 * to inject into Claude's system prompt. Format:
 *
 * ```markdown
 * ---
 * name: my-skill
 * description: Does something useful
 * triggers:
 *   - keyword1
 *   - keyword2
 * tools:
 *   - obsidian_search
 * alwaysActive: false
 * ---
 *
 * # Skill Content
 *
 * Instructions for Claude when this skill is active...
 * ```
 */
export class SkillLoader {
  private app: App;
  private settings: SkillSettings;
  private skills: Map<string, Skill> = new Map();

  constructor(app: App, settings: SkillSettings) {
    this.app = app;
    this.settings = settings;
  }

  /**
   * Update settings (e.g., when folder path changes).
   */
  updateSettings(settings: SkillSettings): void {
    this.settings = settings;
  }

  /**
   * Load all skills from the configured folder.
   */
  async loadSkills(): Promise<Skill[]> {
    if (!this.settings.enabled) {
      log.debug('Skills disabled, skipping load');
      return [];
    }

    const folderPath = this.settings.folderPath;
    const folder = this.app.vault.getAbstractFileByPath(folderPath);

    if (!folder) {
      log.debug('Skills folder not found', { path: folderPath });
      return [];
    }

    this.skills.clear();
    const files = this.app.vault.getMarkdownFiles().filter(
      (f) => f.path.startsWith(folderPath + '/') && f.name.endsWith('.md')
    );

    log.info('Loading skills', { folderPath, fileCount: files.length });

    for (const file of files) {
      try {
        const skill = await this.parseSkillFile(file);
        if (skill) {
          this.skills.set(skill.name, skill);
          log.debug('Loaded skill', { name: skill.name, triggers: skill.triggers });
        }
      } catch (error) {
        log.error('Failed to parse skill file', error, { path: file.path });
      }
    }

    log.info('Skills loaded', { count: this.skills.size });
    return Array.from(this.skills.values());
  }

  /**
   * Get all loaded skills.
   */
  getSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get a skill by name.
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Parse a single SKILL.md file.
   */
  private async parseSkillFile(file: TFile): Promise<Skill | null> {
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.parseFrontmatter(content);

    if (!body.trim()) {
      log.warn('Skill file has no content', { path: file.path });
      return null;
    }

    // Generate name from filename if not in frontmatter
    const name = frontmatter.name ?? this.fileNameToSkillName(file.name);

    return {
      name,
      description: frontmatter.description ?? '',
      path: file.path,
      triggers: frontmatter.triggers ?? [],
      tools: frontmatter.tools,
      content: body.trim(),
      alwaysActive: frontmatter.alwaysActive ?? false,
    };
  }

  /**
   * Parse YAML frontmatter from markdown content.
   */
  private parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return { frontmatter: {}, body: content };
    }

    const yamlContent = match[1];
    const body = content.slice(match[0].length);

    try {
      const frontmatter = this.parseYaml(yamlContent);
      return { frontmatter, body };
    } catch (error) {
      log.warn('Failed to parse frontmatter', { error });
      return { frontmatter: {}, body: content };
    }
  }

  /**
   * Simple YAML parser for frontmatter.
   * Handles basic key-value pairs and arrays.
   */
  private parseYaml(yaml: string): SkillFrontmatter {
    const result: Record<string, unknown> = {};
    const lines = yaml.split('\n');
    let currentKey: string | null = null;
    let currentArray: string[] | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Check for array item
      if (trimmed.startsWith('- ') && currentKey && currentArray) {
        currentArray.push(trimmed.slice(2).trim());
        continue;
      }

      // Check for key-value pair
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        // Save previous array if any
        if (currentKey && currentArray) {
          result[currentKey] = currentArray;
        }

        const key = trimmed.slice(0, colonIndex).trim();
        const value = trimmed.slice(colonIndex + 1).trim();

        if (value === '' || value === '[]') {
          // Start of array or empty value
          currentKey = key;
          currentArray = [];
        } else if (value === 'true') {
          result[key] = true;
          currentKey = null;
          currentArray = null;
        } else if (value === 'false') {
          result[key] = false;
          currentKey = null;
          currentArray = null;
        } else if (value.startsWith('[') && value.endsWith(']')) {
          // Inline array
          const items = value.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
          result[key] = items.filter((s) => s);
          currentKey = null;
          currentArray = null;
        } else {
          // Simple string value
          result[key] = value.replace(/^['"]|['"]$/g, '');
          currentKey = null;
          currentArray = null;
        }
      }
    }

    // Save last array if any
    if (currentKey && currentArray) {
      result[currentKey] = currentArray;
    }

    return result as SkillFrontmatter;
  }

  /**
   * Convert filename to skill name.
   * e.g., "my-skill.md" -> "my-skill"
   */
  private fileNameToSkillName(filename: string): string {
    return filename.replace(/\.md$/i, '').toLowerCase();
  }
}
