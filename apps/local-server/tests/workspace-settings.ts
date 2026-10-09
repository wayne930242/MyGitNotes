import { deriveAlias, repositoryName, repositoryRef, siteOf, type SourceConfig, type WorkspaceMember, type WorkspaceSettings } from '@mygitnotes/core';

export interface MemberOptions {
  /** Local mode: the worktree of a platform repository; a local source's worktree is its own path. */
  worktree?: string;
  hidden?: boolean;
}

/**
 * The settings of a workspace with one member per source, in order, the first the default; aliases derive from the
 * repositories' names as a deployment's do. The site is the first source's.
 */
export function workspaceSettings(sources: (SourceConfig | [SourceConfig, MemberOptions])[]): WorkspaceSettings {
  const taken = new Set<string>();
  const members = sources.map((entry, index): WorkspaceMember => {
    const [source, options] = Array.isArray(entry) ? entry : [entry, {}];
    const alias = deriveAlias(repositoryName(source), taken);
    taken.add(alias);
    const localPath = source.type === 'local' ? source.path : options.worktree;
    return { ref: repositoryRef(source), alias, default: index === 0, hidden: options.hidden ?? false, ...(localPath ? { localPath } : {}) };
  });
  const [first] = sources;
  return { site: first ? siteOf(Array.isArray(first) ? first[0] : first) : { type: 'github' }, members, manifest: (_member, inRepository) => inRepository() };
}
