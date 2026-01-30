/**
 * Bundled skills that can be fetched from remote sources.
 * These are downloaded and installed to the user's skills folder.
 */

import { requestUrl } from 'obsidian';
import { createLogger } from '../logger';

const log = createLogger('BundledSkills');

export interface BundledSkillSource {
  /** Filename to save as (e.g., "obsidian-markdown.md") */
  filename: string;
  /** URL to fetch the skill content from */
  url: string;
  /** Attribution/source info */
  source: string;
}

/**
 * Remote skill sources to fetch.
 * These are downloaded fresh from GitHub.
 */
export const BUNDLED_SKILL_SOURCES: BundledSkillSource[] = [
  {
    filename: 'obsidian-markdown.md',
    url: 'https://raw.githubusercontent.com/kepano/obsidian-skills/main/skills/obsidian-markdown/SKILL.md',
    source: 'kepano/obsidian-skills',
  },
];

/**
 * Fetch a skill from a remote URL.
 * Returns the content or null if fetch fails.
 */
export async function fetchSkillContent(source: BundledSkillSource): Promise<string | null> {
  try {
    log.info('Fetching bundled skill', { filename: source.filename, url: source.url });

    const response = await requestUrl({
      url: source.url,
      method: 'GET',
    });

    if (response.status !== 200) {
      log.warn('Failed to fetch skill', { filename: source.filename, status: response.status });
      return null;
    }

    const content = response.text;

    // Add attribution comment at the end if not already present
    if (!content.includes(source.source)) {
      return `${content}\n\n<!-- Source: ${source.source} -->\n`;
    }

    return content;
  } catch (error) {
    log.error('Error fetching skill', error, { filename: source.filename });
    return null;
  }
}
