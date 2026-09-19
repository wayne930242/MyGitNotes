import { describe, expect, it } from 'vitest';
import type { FileEntry } from './files-api.js';
import { buildFileTree, expandedPathsFor, isMarkdownFile } from './file-tree.js';

const entry = (path: string, directory: boolean): FileEntry => ({ path, name: path.slice(path.lastIndexOf('/') + 1), directory, size: 0, hidden: false, presentation: 'file' });

describe('isMarkdownFile', () => {
  it('matches .md and .markdown case-insensitively', () => {
    expect(isMarkdownFile('index.md')).toBe(true);
    expect(isMarkdownFile('README.MARKDOWN')).toBe(true);
    expect(isMarkdownFile('post.mdx')).toBe(true);
    expect(isMarkdownFile('DOC.MDX')).toBe(true);
  });
  it('rejects other extensions', () => {
    expect(isMarkdownFile('photo.png')).toBe(false);
    expect(isMarkdownFile('_dir.yml')).toBe(false);
  });
});

describe('buildFileTree', () => {
  const root = 'notes/life';

  it('nests subfolders under their parent, preserving listing order', () => {
    const entries = [entry(`${root}/tech`, true), entry(`${root}/tech/frontend`, true), entry(`${root}/health`, true)];
    const { roots: tree } = buildFileTree(entries, root);
    expect(tree.map(node => node.path)).toEqual([`${root}/tech`, `${root}/health`]);
    expect(tree[0].children.map(node => node.path)).toEqual([`${root}/tech/frontend`]);
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children[0].depth).toBe(1);
  });

  it('marks a folder with a direct non-document, non-structural file', () => {
    const entries = [entry(`${root}/tech`, true), entry(`${root}/tech/notes.md`, false), entry(`${root}/tech/_dir.yml`, false), entry(`${root}/tech/diagram.png`, false)];
    const { roots: tree } = buildFileTree(entries, root);
    expect(tree[0].hasNonDocument).toBe(true);
  });

  it('leaves a folder unmarked when it only holds documents and _dir.yml', () => {
    const entries = [entry(`${root}/tech`, true), entry(`${root}/tech/notes.md`, false), entry(`${root}/tech/_dir.yml`, false)];
    const { roots: tree } = buildFileTree(entries, root);
    expect(tree[0].hasNonDocument).toBe(false);
  });

  it('propagates a descendant non-document marker up to every ancestor', () => {
    const entries = [entry(`${root}/tech`, true), entry(`${root}/tech/frontend`, true), entry(`${root}/tech/frontend/screenshot.png`, false)];
    const { roots: tree } = buildFileTree(entries, root);
    expect(tree[0].hasNonDocument).toBe(true);
    expect(tree[0].children[0].hasNonDocument).toBe(true);
  });

  it('marks the notebook root when a non-document file sits directly at the root', () => {
    const entries = [entry(`${root}/index.md`, false), entry(`${root}/photo.png`, false)];
    const { rootHasNonDocument } = buildFileTree(entries, root);
    expect(rootHasNonDocument).toBe(true);
  });

  it('marks the notebook root when a non-document file sits in a descendant folder', () => {
    const entries = [entry(`${root}/tech`, true), entry(`${root}/tech/diagram.png`, false)];
    const { rootHasNonDocument } = buildFileTree(entries, root);
    expect(rootHasNonDocument).toBe(true);
  });

  it('leaves the notebook root unmarked when only documents and _dir.yml sit at the root', () => {
    const entries = [entry(`${root}/index.md`, false), entry(`${root}/_dir.yml`, false)];
    const { rootHasNonDocument } = buildFileTree(entries, root);
    expect(rootHasNonDocument).toBe(false);
  });
});

describe('expandedPathsFor', () => {
  const root = 'notes/life';

  it('returns every ancestor plus the target path itself', () => {
    expect(expandedPathsFor(`${root}/tech/frontend`, root)).toEqual([`${root}/tech`, `${root}/tech/frontend`]);
  });

  it('returns nothing for the root itself', () => {
    expect(expandedPathsFor(root, root)).toEqual([]);
  });
});
