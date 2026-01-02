import type { App } from 'obsidian';
import type { Skill, SkillSettings } from '../types';
import { SkillLoader } from './SkillLoader';
import { createLogger } from '../Logger';

const log = createLogger('SkillRegistry');

/**
 * Manages skills and their injection into the system prompt.
 *
 * The registry:
 * - Loads skills from the vault via SkillLoader
 * - Matches skills based on message content (triggers)
 * - Builds enhanced system prompts with active skills
 */
export class SkillRegistry {
  private app: App;
  private settings: SkillSettings;
  private loader: SkillLoader;
  private skills: Skill[] = [];
  private initialized = false;

  constructor(app: App, settings: SkillSettings) {
    this.app = app;
    this.settings = settings;
    this.loader = new SkillLoader(app, settings);
  }

  /**
   * Initialize the registry by loading all skills.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!this.settings.enabled) {
      log.debug('Skills disabled, skipping initialization');
      return;
    }

    try {
      this.skills = await this.loader.loadSkills();
      this.initialized = true;
      log.info('SkillRegistry initialized', { skillCount: this.skills.length });
    } catch (error) {
      log.error('Failed to initialize SkillRegistry', error);
    }
  }

  /**
   * Update settings and reload skills if folder changed.
   */
  async updateSettings(settings: SkillSettings): Promise<void> {
    const folderChanged = settings.folderPath !== this.settings.folderPath;
    this.settings = settings;
    this.loader.updateSettings(settings);

    if (folderChanged || !this.initialized) {
      this.initialized = false;
      await this.initialize();
    }
  }

  /**
   * Reload all skills from disk.
   */
  async reload(): Promise<void> {
    this.initialized = false;
    this.skills = [];
    await this.initialize();
  }

  /**
   * Get all loaded skills.
   */
  getSkills(): Skill[] {
    return this.skills;
  }

  /**
   * Find skills that match the given message content.
   * A skill matches if any of its triggers appear in the message.
   */
  matchSkills(message: string): Skill[] {
    if (!this.settings.enabled) return [];

    const messageLower = message.toLowerCase();
    const matched: Skill[] = [];

    for (const skill of this.skills) {
      // Always-active skills always match
      if (skill.alwaysActive) {
        matched.push(skill);
        continue;
      }

      // Check triggers
      for (const trigger of skill.triggers) {
        if (messageLower.includes(trigger.toLowerCase())) {
          matched.push(skill);
          break;
        }
      }
    }

    if (matched.length > 0) {
      log.debug('Skills matched', {
        message: message.slice(0, 50),
        skills: matched.map((s) => s.name),
      });
    }

    return matched;
  }

  /**
   * Find skills relevant to the given tools being used.
   */
  matchByTools(toolNames: string[]): Skill[] {
    if (!this.settings.enabled) return [];

    const matched: Skill[] = [];

    for (const skill of this.skills) {
      if (!skill.tools) continue;

      for (const tool of skill.tools) {
        if (toolNames.includes(tool)) {
          matched.push(skill);
          break;
        }
      }
    }

    return matched;
  }

  /**
   * Build an enhanced system prompt by injecting active skills.
   *
   * @param basePrompt The base system prompt
   * @param message The user message (for trigger matching)
   * @param activeTools Tools currently in use (for tool matching)
   */
  buildSystemPrompt(
    basePrompt: string,
    message: string,
    activeTools: string[] = []
  ): string {
    if (!this.settings.enabled) {
      return basePrompt;
    }

    // Find matching skills
    const messageSkills = this.matchSkills(message);
    const toolSkills = this.matchByTools(activeTools);

    // Deduplicate skills
    const allSkills = new Map<string, Skill>();
    for (const skill of [...messageSkills, ...toolSkills]) {
      allSkills.set(skill.name, skill);
    }

    if (allSkills.size === 0) {
      return basePrompt;
    }

    // Build skills section
    const skillsSection = this.buildSkillsSection(Array.from(allSkills.values()));

    // Inject after base prompt
    return `${basePrompt}\n\n${skillsSection}`;
  }

  /**
   * Build the skills section to inject into the system prompt.
   */
  private buildSkillsSection(skills: Skill[]): string {
    const sections: string[] = [];

    sections.push('<active_skills>');
    sections.push('The following skills are active for this conversation:\n');

    for (const skill of skills) {
      sections.push(`## ${skill.name}`);
      if (skill.description) {
        sections.push(`*${skill.description}*\n`);
      }
      sections.push(skill.content);
      sections.push('');
    }

    sections.push('</active_skills>');

    return sections.join('\n');
  }
}
