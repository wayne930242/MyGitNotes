export interface RenderedNoteTemplate {
  content: string;
  metadata: Record<string, unknown>;
}

export interface NewNoteDraft {
  content: string;
  metadata: Record<string, unknown>;
  status: string;
}

/**
 * Builds a new note's initial content, metadata and status. A template supplies the content
 * and any extra metadata fields, but the tags and status the user confirmed in the dialog
 * always win over whatever the re-rendered template would otherwise set.
 */
export function buildNewNoteDraft(params: { slug: string; title: string; tags: string[]; status: string; template?: RenderedNoteTemplate; }): NewNoteDraft {
  const { slug, title, tags, status, template } = params;
  if (!template) return { content: `# ${title}\n\nWrite your note here.\n`, metadata: { id: slug, title, tags }, status };
  return { content: template.content, metadata: { id: slug, ...template.metadata, tags }, status };
}
