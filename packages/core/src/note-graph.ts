import { NoteItem } from './types.js';
import { resolveWorkspaceHref } from './workspace-links.js';

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
}

export function extractNoteLinks(content: string, sourcePath: string, validNotePaths: Set<string>): string[] {
  if (!content) return [];
  const targets = new Set<string>();

  // 1. Regular markdown links: [text](target) - exclude image embeds ![alt](...)
  const mdLinkRegex = /(?:^|[^!])\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = mdLinkRegex.exec(content)) !== null) {
    const rawHref = match[2]?.trim();
    if (!rawHref) continue;
    const resolved = resolveWorkspaceHref(rawHref, sourcePath);
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
  }

  // 2. Wikilinks: [[target]] or [[target|label]]
  const wikiLinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
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

export function buildNoteGraph(notes: NoteItem[], options?: NoteGraphOptions): NoteGraphData {
  let filteredNotes = notes;
  if (!options?.includeHidden) {
    filteredNotes = filteredNotes.filter((n) => !n.metadata?.hiden && (n as unknown as { hiden?: boolean }).hiden !== true);
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
    const targets = extractNoteLinks(note.content, note.path, validPaths);
    outDegreeMap.set(note.path, targets.length);
    for (const target of targets) {
      links.push({ source: note.path, target });
      inDegreeMap.set(target, (inDegreeMap.get(target) || 0) + 1);
    }
  }

  const nodes: NoteGraphNode[] = filteredNotes.map((note) => {
    const inDegree = inDegreeMap.get(note.path) || 0;
    const outDegree = outDegreeMap.get(note.path) || 0;
    return {
      id: note.path,
      title: note.title || note.path.split('/').pop()?.replace(/\.md$/, '') || note.path,
      notebookId: note.notebookId,
      status: note.status,
      tags: note.tags || [],
      inDegree,
      outDegree,
      val: Math.max(3, Math.min(18, 3 + inDegree * 2.5)),
    };
  });

  return { nodes, links };
}
