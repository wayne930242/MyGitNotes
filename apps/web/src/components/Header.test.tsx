import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Header } from './Header.js';
import type { WorkspaceTab } from '../lib/routes.js';

vi.mock('./Select.js', () => ({
  Select: ({ options }: { options: { value: string }[] }) =>
    createElement('output', { 'data-options': options.map(option => option.value).join(',') }),
}));

describe('Header notebook selector', () => {
  it.each(['notes', 'graph', 'assets', 'screen', 'agent', 'settings'] as WorkspaceTab[])('lists only notebooks on %s', activeTab => {
    const html = renderToStaticMarkup(createElement(Header, {
      workspaceTitle: 'Notes', activeTab, setActiveTab: () => {}, selectedNotebookId: 'work',
      notebooks: ['work', 'reading'].map(id => ({ id, title: id, root: `notes/${id}` })),
      onSelectNotebook: () => {}, onCreateNote: () => {}, onOpenCommands: () => {},
    }));
    expect(html).toContain('data-options="work,reading"');
  });
});
