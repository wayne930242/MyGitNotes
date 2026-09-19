import type { NotebookConfig, NoteItem } from './types.js';
import { noteMarkdownLink, resolveWorkspaceHref } from './workspace-links.js';
import { marked } from 'marked';

export interface NoteGraphNode {
  id: string;
  external?: boolean;
  title: string;
  notebookId: string;
  status?: string;
  tags: string[];
  inDegree: number;
  outDegree: number;
  val: number;
}

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
  /** Notebooks for path alias resolution; the browser registry is used when omitted. */
  notebooks?: NotebookConfig[];
}

export function extractNoteLinks(content: string, sourcePath: string, validNotePaths: Set<string>, notebooks?: NotebookConfig[]): string[] {
  if (!content) return [];
  const targets = new Set<string>();

  // 1. Regular markdown links: [text](target) - exclude image embeds ![alt](...)
  marked.walkTokens(marked.lexer(content), token => {
    if (token.type !== 'link') return;
    const rawHref = token.href?.trim();
    if (!rawHref) return;
    const resolved = resolveWorkspaceHref(rawHref, sourcePath, notebooks);
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
    filteredNotes = filteredNotes.filter((n) => !n.metadata?.hiden && (n as unknown as { hiden?: boolean; }).hiden !== true);
  }
  if (options?.notebookId) {
    filteredNotes = filteredNotes.filter((n) => n.notebookId === options.notebookId);
  }
  if (options?.tag) {
    filteredNotes = filteredNotes.filter((n) => n.tags?.includes(options.tag!));
  }

  const validPaths = new Set(filteredNotes.map((n) => n.path));
  const links: NoteGraphLink[] = [];
  const inDegreeMap = new Map<string, number>();
  const outDegreeMap = new Map<string, number>();

  for (const path of validPaths) {
    inDegreeMap.set(path, 0);
    outDegreeMap.set(path, 0);
  }

  for (const note of filteredNotes) {
    const targets = extractNoteLinks(note.content, note.path, validPaths, options?.notebooks);
    outDegreeMap.set(note.path, targets.length);
    for (const target of targets) {
      links.push({ source: note.path, target });
      inDegreeMap.set(target, (inDegreeMap.get(target) || 0) + 1);
    }
  }

  const nodes: NoteGraphNode[] = filteredNotes.map((note) => {
    const inDegree = inDegreeMap.get(note.path) || 0;
    const outDegree = outDegreeMap.get(note.path) || 0;
    return { id: note.path, title: note.title || note.path.split('/').pop()?.replace(/\.md$/, '') || note.path, notebookId: note.notebookId, status: note.status, tags: note.tags || [], inDegree, outDegree, val: Math.max(3, Math.min(18, 3 + inDegree * 2.5)) };
  });

  return { nodes, links };
}
