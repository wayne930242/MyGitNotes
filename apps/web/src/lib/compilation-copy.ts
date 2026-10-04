import { compilationCopyPath, compilationFile, type CompilationRow, copyCompilation, serializeCompilation } from '@mygitnotes/core/compilation';
import { compilationMetadata } from './compilation-rows.js';
import { listCompilations } from './compilation-lookup.js';
import { firstFreePath } from './compilation-paths.js';

export interface CompilationCopy {
  path: string;
  content: string;
  metadata: Record<string, unknown>;
  title: string;
}

/** The copy of a compilation: `<title> copy` in `<name>-copy.compilation.yml` beside it, with a new id and new item ids. */
export async function planCompilationCopy(row: CompilationRow): Promise<CompilationCopy> {
  const path = await firstFreePath(row.notebookId, taken => compilationCopyPath(row.path, taken));
  const file = copyCompilation(compilationFile(row), (await listCompilations()).flatMap(note => typeof note.metadata.id === 'string' ? [note.metadata.id] : []));
  return { path, content: serializeCompilation(file), metadata: compilationMetadata({ ...row, name: file.title }), title: file.title };
}
