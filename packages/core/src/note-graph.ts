import type { NotebookConfig, NoteItem } from './types.js';
import { noteRefKey } from './note-query.js';
import { noteMarkdownLink, resolveWorkspaceHref } from './workspace-links.js';
import { marked } from 'marked';

export interface NoteGraphNode {
  /** `noteRefKey` of the note, since equal paths in two repositories are different notes. */
  id: string;
  path: string;
  external?: boolean;
  title: string;
  notebookId: string;
  status?: string;
  tags: string[];
  inDegree: number;
  outDegree: number;
  val: number;
}

/** Endpoints are node ids. */
export interface NoteGraphLink {
  source: string;
  target: string;
}

export interface NoteGraphData {
  nodes: NoteGraphNode[];
  links: NoteGraphLink[];
}

export interface NoteGraphOptions {
  includeHidden?: boolean;
  notebookId?: string | null;
  tag?: string | null;
  /** Notebooks whose own `pathAliases` resolve their notes' links; the browser registry is used when omitted. */
  notebooks?: NotebookConfig[];
  /** The repository serving a notebook. A link resolves only among the notes of its note's repository; one repository when omitted. */
  repositoryOf?: (notebookId: string) => string;
}

/** Link targets among `validNotePaths`, which should hold only the paths of the source note's repository. */
export function extractNoteLinks(content: string, sourcePath: string, validNotePaths: Set<string>, aliasesOrNotebooks?: Record<string, string> | NotebookConfig[]): string[] {
  if (!content) return [];
  const targets = new Set<string>();

  // 1. Regular markdown links: [text](target) - exclude image embeds ![alt](...)
  marked.walkTokens(marked.lexer(content), token => {
    if (token.type !== 'link') return;
    const rawHref = token.href?.trim();
    if (!rawHref) return;
    const resolved = resolveWorkspaceHref(rawHref, sourcePath, aliasesOrNotebooks);
    if (resolved && resolved.kind === 'path') {
      const targetPath = resolved.path;
      if (validNotePaths.has(targetPath)) {
        targets.add(targetPath);
      } else if (validNotePaths.has(`${targetPath}.md`)) {
        targets.add(`${targetPath}.md`);
      } else if (validNotePaths.has(`${targetPath}/index.md`)) {
        targets.add(`${targetPath}/index.md`);
      }
    }
  });

  // 2. Wikilinks: [[target]] or [[target|label]]
  const wikiLinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = wikiLinkRegex.exec(content)) !== null) {
    const targetName = match[1]?.trim();
    if (!targetName) continue;
    for (const validPath of validNotePaths) {
      if (validPath === targetName || validPath.endsWith(`/${targetName}`) || validPath.endsWith(`/${targetName}.md`)) {
        targets.add(validPath);
        break;
      }
    }
  }

  // Filter out self-loops
  targets.delete(sourcePath);

  return Array.from(targets);
}

export function insertNoteLink(content: string, sourcePath: string, targetPath: string, title: string, caret?: number): { content: string; position: number; } {
  if (sourcePath === targetPath || extractNoteLinks(content, sourcePath, new Set([targetPath])).includes(targetPath)) return { content, position: caret ?? content.length };
  const position = caret === undefined ? content.length : Math.max(0, Math.min(content.length, caret));
  const link = (caret === undefined && content && !content.endsWith('\n\n') ? '\n\n' : '') + noteMarkdownLink(sourcePath, targetPath, title);
  return { content: content.slice(0, position) + link + content.slice(position), position: position + link.length };
}

export function buildNoteGraph(notes: NoteItem[], options?: NoteGraphOptions): NoteGraphData {
  let filteredNotes = notes;
  if (!options?.includeHidden) {
    // SAFETY: Legacy note records may carry `hiden` at the top level despite NoteItem omitting that historical field.
    filteredNotes = filteredNotes.filter((n) => !n.metadata?.hiden && (n as unknown as { hiden?: boolean; }).hiden !== true);
  }
  if (options?.notebookId) {
    filteredNotes = filteredNotes.filter((n) => n.notebookId === options.notebookId);
  }
  if (options?.tag) {
    filteredNotes = filteredNotes.filter((n) => n.tags?.includes(options.tag!));
  }

  // Paths are unique within a repository, so each repository maps its note paths to node ids.
  const repositoryOf = options?.repositoryOf ?? (() => '');
  const scopes = new Map<string, Map<string, string>>();
  for (const note of filteredNotes) {
    const repository = repositoryOf(note.notebookId);
    if (!scopes.has(repository)) scopes.set(repository, new Map());
    scopes.get(repository)!.set(note.path, noteRefKey(note));
  }
  const scopePaths = new Map([...scopes].map(([repository, ids]) => [repository, new Set(ids.keys())]));
  // The source notebook is known, so its own aliases apply; roots may repeat across repositories.
  const aliasesOf = (notebookId: string) => options?.notebooks?.find(notebook => notebook.id === notebookId)?.pathAliases ?? {};
  const links: NoteGraphLink[] = [];
  const inDegreeMap = new Map<string, number>();
  const outDegreeMap = new Map<string, number>();

  for (const note of filteredNotes) {
    const repository = repositoryOf(note.notebookId), ids = scopes.get(repository)!, source = noteRefKey(note);
    const targets = extractNoteLinks(note.content, note.path, scopePaths.get(repository)!, aliasesOf(note.notebookId));
    outDegreeMap.set(source, targets.length);
    for (const targetPath of targets) {
      const target = ids.get(targetPath)!;
      links.push({ source, target });
      inDegreeMap.set(target, (inDegreeMap.get(target) || 0) + 1);
    }
  }

  const nodes: NoteGraphNode[] = filteredNotes.map((note) => {
    const id = noteRefKey(note), inDegree = inDegreeMap.get(id) || 0, outDegree = outDegreeMap.get(id) || 0;
    return { id, path: note.path, title: note.title || note.path.split('/').pop()?.replace(/\.md$/, '') || note.path, notebookId: note.notebookId, status: note.status, tags: note.tags || [], inDegree, outDegree, val: Math.max(3, Math.min(18, 3 + inDegree * 2.5)) };
  });

  return { nodes, links };
}
