import { type CompilationRow, compilationCopyPath, compilationFile, copyCompilation, serializeCompilation } from '@mygitnotes/core/compilation';
import { compilationMetadata } from './compilation-rows.js';
import { listCompilations } from './compilation-lookup.js';
import { lookupNotes } from './notes-api.js';

/** How many `-copy-N` names are tried before a copy gives up. */
const COPY_NAMES = 20;

export interface CompilationCopy {
  path: string;
  content: string;
  metadata: Record<string, unknown>;
  title: string;
}

/** The copy of a compilation: `<title> copy` in `<name>-copy.compilation.yml` beside it, with a new id and new item ids. */
export async function planCompilationCopy(row: CompilationRow): Promise<CompilationCopy> {
  const tried: string[] = [];
  compilationCopyPath(row.path, path => {
    tried.push(path);
    return tried.length < COPY_NAMES;
  });
  const existing = new Set((await lookupNotes(tried.map(path => ({ notebookId: row.notebookId, path })))).notes.map(note => note.path));
  const path = compilationCopyPath(row.path, candidate => existing.has(candidate));
  if (existing.has(path)) throw new Error('Too many copies of this compilation already exist.');
  const file = copyCompilation(compilationFile(row), (await listCompilations()).flatMap(note => typeof note.metadata.id === 'string' ? [note.metadata.id] : []));
  return { path, content: serializeCompilation(file), metadata: compilationMetadata({ ...row, name: file.title }), title: file.title };
}
