import type express from 'express';
import type { PublishedNote } from './gists.js';
import type { RemoteHandle } from './request-workspace.js';

/** What an edition's publishing service reports for one committed note; the web app shows `error` and `notices` beside the commit result. */
export interface PublishSync {
  path: string;
  /** Where the note is published, when it is. */
  url?: string;
  error?: string;
  /** Things that did not stop the publication but the person should know, such as an image left out. */
  notices?: string[];
}

/** What an edition's publishing service is handed after a commit or save succeeded. */
export interface PublishingRequest {
  req: express.Request;
  res: express.Response;
  /** The repository the notes were committed to. */
  repository: RemoteHandle;
  /** The committed notes (deletions excluded), in the shape Gists receive: the body without frontmatter, and the metadata. */
  notes: PublishedNote[];
}

/**
 * Publishes committed notes beyond the repository, such as to a public page. It runs after the commit has succeeded,
 * as Gist updates do, so a failure belongs to its note and never undoes the commit. The community edition has none.
 */
export interface PublishingService {
  sync(request: PublishingRequest): Promise<PublishSync[]>;
}

/** The committed notes as a service takes them; entries that are not notes are dropped. */
export function publishableNotes(notes: unknown): PublishedNote[] {
  if (!Array.isArray(notes)) return [];
  return notes.flatMap((note): PublishedNote[] => {
    if (!note || typeof note !== 'object' || (note as { delete?: unknown; }).delete === true) return [];
    const { path, content, metadata } = note as { path?: unknown; content?: unknown; metadata?: unknown; };
    if (typeof path !== 'string' || typeof content !== 'string') return [];
    return [{ path, content, metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {} }];
  });
}

/** Runs the service for committed notes and returns the `published` entry of the answer; nothing without a service or notes. */
export async function publishNotes(service: PublishingService | undefined, request: Omit<PublishingRequest, 'notes'> & { notes: unknown; }): Promise<{ published?: PublishSync[]; }> {
  const notes = publishableNotes(request.notes);
  if (!service || !notes.length) return {};
  try {
    return { published: await service.sync({ ...request, notes }) };
  } catch (error) {
    console.error(`[publishing] ${error instanceof Error ? error.message : 'sync failed'}`);
    return { published: notes.map(note => ({ path: note.path, error: 'Publishing failed. Commit the note again to retry.' })) };
  }
}
