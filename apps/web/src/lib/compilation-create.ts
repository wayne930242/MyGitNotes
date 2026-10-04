import type { CompilationRow } from '@mygitnotes/core/compilation';
import { compilationMetadata, compilationText } from './compilation-rows.js';
import { newCompilationPath } from './use-compilation.js';
import { firstFreePath } from './compilation-paths.js';
import type { NotebookConfig } from './types.js';

export interface NewCompilation {
  path: string;
  content: string;
  metadata: Record<string, unknown>;
}

/** The file for a new compilation `row` in `folder` (relative to the notebook root): `<name>.compilation.yml`, suffixed when taken. */
export async function planNewCompilation(row: CompilationRow, notebook: NotebookConfig, folder: string): Promise<NewCompilation> {
  const path = await firstFreePath(notebook.id, taken => newCompilationPath(notebook, row.name, taken, folder));
  return { path, content: compilationText({ ...row, path }), metadata: compilationMetadata(row) };
}
