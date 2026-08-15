import { Inject, Injectable, Logger } from '@nestjs/common';

import { CACHE_STORE } from '../cache';
import type { CacheStore } from '../cache';
import { AppConfigService } from '../config';
import { PlaneApiClient } from '../plane';
import type { PlaneProject } from '../plane';

const CACHE_KEY_VERSION = 'v1';

/**
 * Resolve however a person refers to a project into the project itself.
 *
 * Nobody thinks in UUIDs. Engineers know their project as `ENG`, and occasionally by its full
 * name — so both work, along with a UUID for scripts. Requiring a UUID would mean opening
 * Plane and copying one out of the URL before every export, which is exactly the friction this
 * tool exists to remove.
 */
@Injectable()
export class ProjectResolver {
  private readonly logger = new Logger(ProjectResolver.name);

  constructor(
    private readonly plane: PlaneApiClient,
    private readonly config: AppConfigService,
    @Inject(CACHE_STORE) private readonly cache: CacheStore,
  ) {}

  /** Resolve one reference: project key, name, or UUID. */
  async resolve(reference: string, options: { forceRefresh?: boolean } = {}): Promise<PlaneProject> {
    const projects = await this.listProjects(options.forceRefresh ?? false);
    const needle = reference.trim().toLowerCase();

    const match =
      projects.find((project) => project.id.toLowerCase() === needle) ??
      projects.find((project) => project.identifier.toLowerCase() === needle) ??
      projects.find((project) => project.name.trim().toLowerCase() === needle);

    if (match) return match;

    // Listing what is available beats "not found": the usual cause is a typo or a project the
    // token's owner is not a member of, and both are obvious once you see the real list.
    const available = projects
      .map((project) => `${project.identifier} (${project.name})`)
      .sort()
      .join(', ');

    throw new Error(
      `No project matches "${reference}". Projects visible to this API token: ${available || '(none)'}`,
    );
  }

  async resolveMany(references: readonly string[], options: { forceRefresh?: boolean } = {}): Promise<PlaneProject[]> {
    const resolved: PlaneProject[] = [];

    for (const reference of references) {
      const project = await this.resolve(reference, options);

      // Exporting the same project twice would produce two identical tabs.
      if (resolved.some((existing) => existing.id === project.id)) {
        this.logger.warn(`Project "${reference}" was requested more than once; ignoring the duplicate`);
        continue;
      }

      resolved.push(project);
    }

    if (resolved.length === 0) throw new Error('No projects were requested');

    return resolved;
  }

  private async listProjects(forceRefresh: boolean): Promise<PlaneProject[]> {
    const key = `plane:projects:${CACHE_KEY_VERSION}:${this.config.plane.workspaceSlug}`;

    if (!forceRefresh) {
      const cached = await this.cache.get<PlaneProject[]>(key);
      if (cached) return cached;
    }

    const projects = await this.plane.listProjects();
    await this.cache.set(key, projects, this.config.lookupCacheTtlSeconds);

    return projects;
  }
}
