import { expect, it } from 'vitest';
import type { NotebookConfig } from './types.js';
import { parseCompilationNote } from './compilation-rows.js';

const notebooks: NotebookConfig[] = [{ id: 'nb1', title: 'NB1', root: 'notes/nb1' }];
const content = 'version: 1\nid: dup\ntitle: Dup\narrangement: lane\nsource:\n  kind: tag\n  tag: x\n';
const note = { path: 'notes/nb1/dup.compilation.yml', notebookId: 'nb1', title: 'Dup', content };

it('parses a valid compilation entry into a row', () => {
  expect(parseCompilationNote(note, notebooks)).toMatchObject({ row: { id: 'dup', name: 'Dup' } });
});
it('opens an entry the catalog marks invalid to its error although the text parses', () => {
  const parsed = parseCompilationNote({ ...note, invalid: 'Duplicate compilation id "dup" in notes/nb1/other.compilation.yml' }, notebooks);
  expect(parsed.row).toBeUndefined();
  expect(parsed.error).toContain('Duplicate compilation id');
});
it('reports a notebook that is not configured', () => {
  expect(parseCompilationNote({ ...note, notebookId: 'ghost' }, notebooks).error).toContain('ghost');
});
